#include "sutra_cef_host.h"

#include <algorithm>
#include <cmath>
#include <cwctype>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "include/cef_app.h"
#include "include/cef_audio_handler.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_devtools_message_observer.h"
#include "include/cef_download_handler.h"
#include "include/cef_image.h"
#include "include/cef_parser.h"
#include "include/cef_permission_handler.h"
#include "include/cef_request_context.h"
#include "include/cef_request_handler.h"
#include "include/cef_values.h"
#include "include/base/cef_bind.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_message_router.h"

namespace {

std::mutex g_gate;
std::unordered_map<uint64_t, CefRefPtr<class SurfaceClient>> g_surfaces;
struct ContextEntry {
  CefRefPtr<CefRequestContext> context;
  size_t reference_count;
};
std::unordered_map<std::wstring, ContextEntry> g_contexts;
sutra_cef_event_callback g_callback = nullptr;
void* g_callback_user_data = nullptr;
bool g_initialized = false;
DWORD g_initialize_thread_id = 0;

std::wstring EscapeJson(const CefString& value) {
  std::wstring output;
  for (const auto character : value.ToWString()) {
    switch (character) {
      case L'\\': output += L"\\\\"; break;
      case L'\"': output += L"\\\""; break;
      case L'\n': output += L"\\n"; break;
      case L'\r': output += L"\\r"; break;
      case L'\t': output += L"\\t"; break;
      default: output += character; break;
    }
  }
  return output;
}

std::wstring Utf8ToWide(const void* value, size_t size) {
  if (value == nullptr || size == 0) return L"{}";
  const auto* bytes = static_cast<const char*>(value);
  const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes,
                                         static_cast<int>(size), nullptr, 0);
  if (length <= 0) return L"{}";
  std::wstring output(static_cast<size_t>(length), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes,
                      static_cast<int>(size), output.data(), length);
  return output;
}

void Notify(uint64_t surface_id, const std::wstring& json) {
  auto callback = g_callback;
  if (callback != nullptr) (void)callback(surface_id, json.c_str(), g_callback_user_data);
}

bool CancelRequested(uint64_t surface_id, const std::wstring& json) {
  auto callback = g_callback;
  return callback != nullptr && callback(surface_id, json.c_str(), g_callback_user_data) != 0;
}

int RequestPermissionDecision(uint64_t surface_id, const CefString& origin,
                              const wchar_t* permission) {
  const std::wstring origin_value = origin.ToWString();
  if (origin_value.size() < 8 || _wcsnicmp(origin_value.c_str(), L"https://", 8) != 0) return 2;
  auto callback = g_callback;
  if (callback == nullptr) return 2;
  return callback(surface_id,
      (L"{\"kind\":\"permission\",\"origin\":\"" + EscapeJson(origin) +
       L"\",\"permission\":\"" + permission + L"\",\"userGesture\":false}").c_str(),
      g_callback_user_data);
}

bool ContainsPasswordValue(CefRefPtr<CefValue> value, int depth = 0) {
  if (!value || depth > 32) return true;
  if (value->GetType() == VTYPE_DICTIONARY) {
    auto dictionary = value->GetDictionary();
    CefDictionaryValue::KeyList keys;
    dictionary->GetKeys(keys);
    for (const auto& key : keys) {
      std::wstring lowered = key.ToWString();
      std::transform(lowered.begin(), lowered.end(), lowered.begin(),
                     [](wchar_t character) {
                       return static_cast<wchar_t>(std::towlower(character));
                     });
      if (lowered == L"password") return true;
      if (ContainsPasswordValue(dictionary->GetValue(key), depth + 1)) return true;
    }
  } else if (value->GetType() == VTYPE_LIST) {
    auto list = value->GetList();
    for (size_t index = 0; index < list->GetSize(); ++index) {
      if (ContainsPasswordValue(list->GetValue(index), depth + 1)) return true;
    }
  }
  return false;
}

std::wstring NormalizeContextKey(const wchar_t* cache_path) {
  std::wstring key(cache_path == nullptr ? L"" : cache_path);
  std::replace(key.begin(), key.end(), L'/', L'\\');
  std::transform(key.begin(), key.end(), key.begin(),
                 [](wchar_t character) {
                   return static_cast<wchar_t>(std::towlower(character));
                 });
  return key;
}

void ReleaseContextLocked(const std::wstring& key) {
  const auto found = g_contexts.find(key);
  if (found == g_contexts.end()) return;
  if (--found->second.reference_count == 0) g_contexts.erase(found);
}

class SutraCefApp final : public CefApp {
 public:
  IMPLEMENT_REFCOUNTING(SutraCefApp);
};

class FaviconDownloadCallback final : public CefDownloadImageCallback {
 public:
  explicit FaviconDownloadCallback(uint64_t id) : id_(id) {}

  void OnDownloadImageFinished(const CefString&, int http_status_code,
                               CefRefPtr<CefImage> image) override {
    CEF_REQUIRE_UI_THREAD();
    if (http_status_code < 200 || http_status_code >= 400 || !image || image->IsEmpty()) return;
    int width = 0;
    int height = 0;
    auto png = image->GetAsPNG(1.0F, true, width, height);
    if (!png || png->GetSize() == 0) return;
    std::vector<unsigned char> bytes(png->GetSize());
    if (png->GetData(bytes.data(), bytes.size(), 0) != bytes.size()) return;
    const CefString encoded = CefBase64Encode(bytes.data(), bytes.size());
    Notify(id_, L"{\"kind\":\"favicon\",\"pngBase64\":\"" +
                    EscapeJson(encoded) + L"\"}");
  }

 private:
  const uint64_t id_;
  IMPLEMENT_REFCOUNTING(FaviconDownloadCallback);
};

class SurfaceClient final : public CefClient,
                            public CefLifeSpanHandler,
                            public CefLoadHandler,
                            public CefDisplayHandler,
                            public CefRequestHandler,
                            public CefPermissionHandler,
                            public CefDownloadHandler,
                            public CefAudioHandler,
                            public CefMessageRouterBrowserSide::Handler,
                            public CefDevToolsMessageObserver {
 public:
  SurfaceClient(uint64_t id, std::wstring context_key)
      : id_(id), context_key_(std::move(context_key)) {}

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }
  CefRefPtr<CefDownloadHandler> GetDownloadHandler() override { return this; }
  CefRefPtr<CefAudioHandler> GetAudioHandler() override { return this; }

  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
                                CefRefPtr<CefFrame> frame,
                                CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override {
    CEF_REQUIRE_UI_THREAD();
    return message_router_ && message_router_->OnProcessMessageReceived(
        browser, frame, source_process, message);
  }

  bool OnBeforePopup(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, int,
                     const CefString& target_url, const CefString&,
                     WindowOpenDisposition, bool user_gesture,
                     const CefPopupFeatures&, CefWindowInfo&,
                     CefRefPtr<CefClient>&, CefBrowserSettings&,
                     CefRefPtr<CefDictionaryValue>&, bool*) override {
    CEF_REQUIRE_UI_THREAD();
    Notify(id_, L"{\"kind\":\"popup\",\"url\":\"" + EscapeJson(target_url) +
                    L"\",\"userGesture\":" + (user_gesture ? L"true}" : L"false}"));
    return true;
  }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    CEF_REQUIRE_UI_THREAD();
    browser_ = browser;
    CefMessageRouterConfig router_config;
    router_config.js_query_function = "sutraPostMessage";
    router_config.js_cancel_function = "sutraCancelMessage";
    message_router_ = CefMessageRouterBrowserSide::Create(router_config);
    message_router_->AddHandler(this, false);
    devtools_registration_ = browser->GetHost()->AddDevToolsMessageObserver(this);
    Notify(id_, L"{\"kind\":\"created\"}");
  }

  bool DoClose(CefRefPtr<CefBrowser>) override {
    CEF_REQUIRE_UI_THREAD();
    return false;
  }

  void OnBeforeClose(CefRefPtr<CefBrowser>) override {
    CEF_REQUIRE_UI_THREAD();
    if (message_router_) {
      message_router_->OnBeforeClose(browser_);
      message_router_->RemoveHandler(this);
      message_router_ = nullptr;
    }
    devtools_registration_ = nullptr;
    browser_ = nullptr;
    std::lock_guard lock(g_gate);
    g_surfaces.erase(id_);
    ReleaseContextLocked(context_key_);
    Notify(id_, L"{\"kind\":\"closed\"}");
  }

  void OnLoadingStateChange(CefRefPtr<CefBrowser>, bool is_loading, bool can_go_back, bool can_go_forward) override {
    CEF_REQUIRE_UI_THREAD();
    Notify(id_, std::wstring(L"{\"kind\":\"loading\",\"isLoading\":") + (is_loading ? L"true" : L"false") +
        L",\"canGoBack\":" + (can_go_back ? L"true" : L"false") + L",\"canGoForward\":" + (can_go_forward ? L"true" : L"false") + L"}");
  }

  void OnLoadError(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, ErrorCode error_code, const CefString& error_text, const CefString& failed_url) override {
    CEF_REQUIRE_UI_THREAD();
    if (!frame->IsMain()) return;
    Notify(id_, L"{\"kind\":\"loadError\",\"url\":\"" + EscapeJson(failed_url) + L"\",\"error\":\"" + EscapeJson(error_text) + L"\",\"code\":" + std::to_wstring(static_cast<int>(error_code)) + L"}");
  }

  void OnAddressChange(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, const CefString& url) override {
    CEF_REQUIRE_UI_THREAD();
    if (frame->IsMain()) Notify(id_, L"{\"kind\":\"address\",\"url\":\"" + EscapeJson(url) + L"\"}");
  }

  void OnTitleChange(CefRefPtr<CefBrowser>, const CefString& title) override {
    CEF_REQUIRE_UI_THREAD();
    Notify(id_, L"{\"kind\":\"title\",\"title\":\"" + EscapeJson(title) + L"\"}");
  }

  void OnStatusMessage(CefRefPtr<CefBrowser>, const CefString& value) override {
    CEF_REQUIRE_UI_THREAD();
    Notify(id_, L"{\"kind\":\"status\",\"text\":\"" + EscapeJson(value) + L"\"}");
  }

  void OnFullscreenModeChange(CefRefPtr<CefBrowser>, bool fullscreen) override {
    CEF_REQUIRE_UI_THREAD();
    Notify(id_, std::wstring(L"{\"kind\":\"fullscreen\",\"value\":") + (fullscreen ? L"true}" : L"false}"));
  }

  void OnFaviconURLChange(CefRefPtr<CefBrowser> browser,
                          const std::vector<CefString>& icon_urls) override {
    CEF_REQUIRE_UI_THREAD();
    if (icon_urls.empty()) return;
    browser->GetHost()->DownloadImage(icon_urls.front(), true, 64, false,
        new FaviconDownloadCallback(id_));
  }

  bool OnBeforeBrowse(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame,
                      CefRefPtr<CefRequest> request, bool user_gesture,
                      bool is_redirect) override {
    CEF_REQUIRE_UI_THREAD();
    if (message_router_) message_router_->OnBeforeBrowse(browser_, frame);
    if (!frame->IsMain()) return false;
    return CancelRequested(id_, L"{\"kind\":\"navigationStarting\",\"url\":\"" +
        EscapeJson(request->GetURL()) + L"\",\"redirect\":" +
        (is_redirect ? L"true" : L"false") + L",\"userGesture\":" +
        (user_gesture ? L"true}" : L"false}"));
  }

  void OnRenderProcessTerminated(CefRefPtr<CefBrowser>, TerminationStatus status,
                                 int error_code, const CefString& error_string) override {
    CEF_REQUIRE_UI_THREAD();
    if (message_router_) message_router_->OnRenderProcessTerminated(browser_);
    Notify(id_, L"{\"kind\":\"processFailed\",\"status\":" +
        std::to_wstring(static_cast<int>(status)) + L",\"code\":" +
        std::to_wstring(error_code) + L",\"reason\":\"" +
        EscapeJson(error_string) + L"\"}");
  }

  bool OnRequestMediaAccessPermission(
      CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, const CefString& requesting_origin,
      uint32_t requested_permissions, CefRefPtr<CefMediaAccessCallback> callback) override {
    CEF_REQUIRE_UI_THREAD();
    const uint32_t supported = CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE |
                               CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE;
    if (requested_permissions == 0 || (requested_permissions & ~supported) != 0) {
      callback->Cancel();
      return true;
    }
    if ((requested_permissions & CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE) != 0 &&
        RequestPermissionDecision(id_, requesting_origin, L"microphone") != 1) {
      callback->Cancel();
      return true;
    }
    if ((requested_permissions & CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE) != 0 &&
        RequestPermissionDecision(id_, requesting_origin, L"camera") != 1) {
      callback->Cancel();
      return true;
    }
    callback->Continue(requested_permissions);
    return true;
  }

  bool OnShowPermissionPrompt(
      CefRefPtr<CefBrowser>, uint64_t, const CefString& requesting_origin,
      uint32_t requested_permissions,
      CefRefPtr<CefPermissionPromptCallback> callback) override {
    CEF_REQUIRE_UI_THREAD();
    struct PermissionMapping { uint32_t flag; const wchar_t* name; };
    const PermissionMapping mappings[] = {
        {CEF_PERMISSION_TYPE_CAMERA_STREAM, L"camera"},
        {CEF_PERMISSION_TYPE_MIC_STREAM, L"microphone"},
        {CEF_PERMISSION_TYPE_GEOLOCATION, L"geolocation"},
        {CEF_PERMISSION_TYPE_NOTIFICATIONS, L"notifications"},
        {CEF_PERMISSION_TYPE_CLIPBOARD, L"clipboardRead"},
        {CEF_PERMISSION_TYPE_MULTIPLE_DOWNLOADS, L"multipleAutomaticDownloads"},
    };
    uint32_t handled = 0;
    bool defaulted = false;
    for (const auto& mapping : mappings) {
      if ((requested_permissions & mapping.flag) == 0) continue;
      handled |= mapping.flag;
      const int decision = RequestPermissionDecision(id_, requesting_origin, mapping.name);
      if (decision == 2) {
        callback->Continue(CEF_PERMISSION_RESULT_DENY);
        return true;
      }
      if (decision != 1) defaulted = true;
    }
    if (handled != requested_permissions || handled == 0) {
      callback->Continue(CEF_PERMISSION_RESULT_DENY);
    } else if (defaulted) {
      callback->Continue(CEF_PERMISSION_RESULT_DISMISS);
    } else {
      callback->Continue(CEF_PERMISSION_RESULT_ACCEPT);
    }
    return true;
  }

  bool OnBeforeDownload(CefRefPtr<CefBrowser>, CefRefPtr<CefDownloadItem> item,
                        const CefString& suggested_name,
                        CefRefPtr<CefBeforeDownloadCallback> callback) override {
    CEF_REQUIRE_UI_THREAD();
    const uint32_t download_id = item->GetId();
    pending_downloads_[download_id] = callback;
    Notify(id_, L"{\"kind\":\"download\",\"downloadId\":" +
        std::to_wstring(download_id) + L",\"url\":\"" + EscapeJson(item->GetURL()) +
        L"\",\"suggestedName\":\"" + EscapeJson(suggested_name) + L"\"}");
    return true;
  }

  void ContinueDownload(uint32_t download_id, const std::wstring& destination,
                        bool cancel) {
    CEF_REQUIRE_UI_THREAD();
    const auto found = pending_downloads_.find(download_id);
    if (found == pending_downloads_.end()) return;
    auto callback = found->second;
    pending_downloads_.erase(found);
    if (!cancel) callback->Continue(destination, destination.empty());
  }

  void OnAudioStreamStarted(CefRefPtr<CefBrowser>, const CefAudioParameters&, int) override {
    Notify(id_, L"{\"kind\":\"media\",\"playing\":true}");
  }

  void OnAudioStreamPacket(CefRefPtr<CefBrowser>, const float**, int, int64_t) override {}

  void OnAudioStreamStopped(CefRefPtr<CefBrowser>) override {
    Notify(id_, L"{\"kind\":\"media\",\"playing\":false}");
  }

  void OnAudioStreamError(CefRefPtr<CefBrowser>, const CefString& message) override {
    Notify(id_, L"{\"kind\":\"audioError\",\"reason\":\"" + EscapeJson(message) + L"\"}");
  }

  bool OnQuery(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, int64_t,
               const CefString& request, bool,
               CefRefPtr<CefMessageRouterBrowserSide::Callback> callback) override {
    CEF_REQUIRE_UI_THREAD();
    if (request.length() == 0 || request.length() > 1024 * 1024) {
      callback->Failure(1, "Page message size is invalid.");
      return true;
    }
    auto parsed = CefParseJSON(request, JSON_PARSER_RFC);
    if (!parsed || (parsed->GetType() != VTYPE_DICTIONARY && parsed->GetType() != VTYPE_LIST)) {
      callback->Failure(2, "Page messages must be a JSON object or array.");
      return true;
    }
    if (ContainsPasswordValue(parsed)) {
      callback->Failure(3, "Password values are not accepted by the page-message bridge.");
      return true;
    }
    Notify(id_, L"{\"kind\":\"pageMessage\",\"source\":\"" +
        EscapeJson(frame->GetURL()) + L"\",\"message\":" + request.ToWString() + L"}");
    callback->Success("");
    return true;
  }

  void OnDevToolsMethodResult(CefRefPtr<CefBrowser>, int message_id,
                              bool success, const void* result,
                              size_t result_size) override {
    CEF_REQUIRE_UI_THREAD();
    Notify(id_, std::wstring(L"{\"kind\":\"scriptResult\",\"requestId\":") +
        std::to_wstring(message_id) + L",\"success\":" +
        (success ? L"true" : L"false") + L",\"result\":" +
        Utf8ToWide(result, result_size) + L"}");
  }

  CefRefPtr<CefBrowser> browser() const { return browser_; }

 private:
  const uint64_t id_;
  const std::wstring context_key_;
  CefRefPtr<CefBrowser> browser_;
  CefRefPtr<CefRegistration> devtools_registration_;
  CefRefPtr<CefMessageRouterBrowserSide> message_router_;
  std::unordered_map<uint32_t, CefRefPtr<CefBeforeDownloadCallback>> pending_downloads_;
  IMPLEMENT_REFCOUNTING(SurfaceClient);
};

CefRefPtr<SurfaceClient> FindSurface(uint64_t id) {
  std::lock_guard lock(g_gate);
  const auto found = g_surfaces.find(id);
  return found == g_surfaces.end() ? nullptr : found->second;
}

template <typename Action>
int WithBrowser(uint64_t id, Action action) {
  auto surface = FindSurface(id);
  if (!surface || !surface->browser()) return 2;
  CefPostTask(TID_UI, base::BindOnce(std::move(action), surface));
  return 0;
}

}  // namespace

int SutraCefInitialize(const wchar_t* runtime_directory, const wchar_t* subprocess_path, const wchar_t* root_cache_path, sutra_cef_event_callback callback, void* user_data) {
  std::lock_guard lock(g_gate);
  if (g_initialized) return 0;
  if (runtime_directory == nullptr || subprocess_path == nullptr || root_cache_path == nullptr) return 1;

  CefMainArgs main_args(GetModuleHandle(nullptr));
  CefSettings settings;
  settings.no_sandbox = true;
  settings.multi_threaded_message_loop = true;
  settings.resources_dir_path = runtime_directory;
  settings.locales_dir_path = std::wstring(runtime_directory) + L"\\locales";
  settings.browser_subprocess_path = subprocess_path;
  settings.root_cache_path = root_cache_path;
  g_callback = callback;
  g_callback_user_data = user_data;
  CefRefPtr<SutraCefApp> app(new SutraCefApp());
  if (!CefInitialize(main_args, settings, app, nullptr)) return 3;
  g_initialized = true;
  g_initialize_thread_id = GetCurrentThreadId();
  return 0;
}

int SutraCefCreateSurface(uint64_t surface_id, HWND parent, int x, int y, int width, int height, const wchar_t* cache_path, int private_mode) {
  if (!g_initialized || parent == nullptr || cache_path == nullptr || width < 0 || height < 0) return 1;
  const std::wstring context_key = NormalizeContextKey(cache_path);
  if (context_key.empty()) return 1;
  CefRefPtr<CefRequestContext> context;
  CefRefPtr<SurfaceClient> client;
  {
    std::lock_guard lock(g_gate);
    if (g_surfaces.contains(surface_id)) return 2;
    const auto existing = g_contexts.find(context_key);
    if (existing != g_contexts.end()) {
      ++existing->second.reference_count;
      context = existing->second.context;
    } else {
      CefRequestContextSettings context_settings;
      context_settings.cache_path = cache_path;
      context_settings.persist_session_cookies = private_mode == 0;
      context = CefRequestContext::CreateContext(context_settings, nullptr);
      if (!context) return 3;
      g_contexts.emplace(context_key, ContextEntry{context, 1});
    }
    client = new SurfaceClient(surface_id, context_key);
    g_surfaces.emplace(surface_id, client);
  }

  CefWindowInfo window_info;
  window_info.SetAsChild(parent, CefRect(x, y, width, height));
  CefBrowserSettings browser_settings;
  if (!CefBrowserHost::CreateBrowser(window_info, client, "about:blank", browser_settings, nullptr, context)) {
    std::lock_guard lock(g_gate);
    g_surfaces.erase(surface_id);
    ReleaseContextLocked(context_key);
    return 3;
  }
  return 0;
}

HWND SutraCefGetWindowHandle(uint64_t id) {
  auto surface = FindSurface(id);
  return surface && surface->browser()
      ? surface->browser()->GetHost()->GetWindowHandle()
      : nullptr;
}

int SutraCefNavigate(uint64_t id, const wchar_t* url) {
  if (url == nullptr) return 1;
  const std::wstring value(url);
  return WithBrowser(id, [value](CefRefPtr<SurfaceClient> surface) { surface->browser()->GetMainFrame()->LoadURL(value); });
}
int SutraCefSetBounds(uint64_t id, int x, int y, int width, int height) {
  return WithBrowser(id, [=](CefRefPtr<SurfaceClient> surface) { SetWindowPos(surface->browser()->GetHost()->GetWindowHandle(), nullptr, x, y, std::max(0, width), std::max(0, height), SWP_NOACTIVATE | SWP_NOZORDER); });
}
int SutraCefSetVisible(uint64_t id, int visible) {
  return WithBrowser(id, [visible](CefRefPtr<SurfaceClient> surface) { ShowWindow(surface->browser()->GetHost()->GetWindowHandle(), visible ? SW_SHOWNA : SW_HIDE); });
}
int SutraCefFocus(uint64_t id) { return WithBrowser(id, [](CefRefPtr<SurfaceClient> surface) { surface->browser()->GetHost()->SetFocus(true); }); }
int SutraCefGoBack(uint64_t id) { return WithBrowser(id, [](CefRefPtr<SurfaceClient> surface) { if (surface->browser()->CanGoBack()) surface->browser()->GoBack(); }); }
int SutraCefGoForward(uint64_t id) { return WithBrowser(id, [](CefRefPtr<SurfaceClient> surface) { if (surface->browser()->CanGoForward()) surface->browser()->GoForward(); }); }
int SutraCefReload(uint64_t id) { return WithBrowser(id, [](CefRefPtr<SurfaceClient> surface) { surface->browser()->Reload(); }); }
int SutraCefStop(uint64_t id) { return WithBrowser(id, [](CefRefPtr<SurfaceClient> surface) { surface->browser()->StopLoad(); }); }
int SutraCefSetMuted(uint64_t id, int muted) { return WithBrowser(id, [muted](CefRefPtr<SurfaceClient> surface) { surface->browser()->GetHost()->SetAudioMuted(muted != 0); }); }
int SutraCefExecuteScript(uint64_t id, int request_id, const wchar_t* script) {
  if (request_id <= 0 || script == nullptr) return 1;
  const std::wstring value(script);
  return WithBrowser(id, [id, request_id, value](CefRefPtr<SurfaceClient> surface) {
    auto parameters = CefDictionaryValue::Create();
    parameters->SetString("expression", value);
    parameters->SetBool("returnByValue", true);
    parameters->SetBool("awaitPromise", true);
    if (surface->browser()->GetHost()->ExecuteDevToolsMethod(
            request_id, "Runtime.evaluate", parameters) == 0) {
      Notify(id, std::wstring(L"{\"kind\":\"scriptResult\",\"requestId\":") +
          std::to_wstring(request_id) +
          L",\"success\":false,\"result\":{\"message\":\"Runtime.evaluate was rejected\"}}");
    }
  });
}
int SutraCefCapturePng(uint64_t id, int request_id) {
  if (request_id <= 0) return 1;
  return WithBrowser(id, [id, request_id](CefRefPtr<SurfaceClient> surface) {
    auto parameters = CefDictionaryValue::Create();
    parameters->SetString("format", "png");
    parameters->SetBool("fromSurface", true);
    if (surface->browser()->GetHost()->ExecuteDevToolsMethod(
            request_id, "Page.captureScreenshot", parameters) == 0) {
      Notify(id, std::wstring(L"{\"kind\":\"scriptResult\",\"requestId\":") +
          std::to_wstring(request_id) +
          L",\"success\":false,\"result\":{\"message\":\"Page.captureScreenshot was rejected\"}}");
    }
  });
}
int SutraCefContinueDownload(uint64_t id, uint32_t download_id,
                              const wchar_t* destination_path, int cancel) {
  const std::wstring destination = destination_path == nullptr ? L"" : destination_path;
  return WithBrowser(id, [download_id, destination, cancel](CefRefPtr<SurfaceClient> surface) {
    surface->ContinueDownload(download_id, destination, cancel != 0);
  });
}
int SutraCefSetZoom(uint64_t id, double factor) {
  if (!std::isfinite(factor) || factor < 0.25 || factor > 5.0) return 1;
  const double level = std::log(factor) / std::log(1.2);
  return WithBrowser(id, [level](CefRefPtr<SurfaceClient> surface) {
    surface->browser()->GetHost()->SetZoomLevel(level);
  });
}
int SutraCefPrint(uint64_t id) { return WithBrowser(id, [](CefRefPtr<SurfaceClient> surface) { surface->browser()->GetHost()->Print(); }); }
int SutraCefOpenDevTools(uint64_t id) {
  return WithBrowser(id, [](CefRefPtr<SurfaceClient> surface) {
    CefWindowInfo window_info;
    window_info.SetAsPopup(nullptr, "Sutra Developer Tools");
    CefBrowserSettings settings;
    surface->browser()->GetHost()->ShowDevTools(window_info, surface, settings, CefPoint());
  });
}
int SutraCefCloseSurface(uint64_t id) { return WithBrowser(id, [](CefRefPtr<SurfaceClient> surface) { surface->browser()->GetHost()->CloseBrowser(true); }); }

int SutraCefShutdown(void) {
  std::lock_guard lock(g_gate);
  if (!g_initialized) return 0;
  if (!g_surfaces.empty()) return 1;
  if (!g_contexts.empty()) return 2;
  if (GetCurrentThreadId() != g_initialize_thread_id) return 3;
  CefShutdown();
  g_initialized = false;
  g_callback = nullptr;
  g_callback_user_data = nullptr;
  g_initialize_thread_id = 0;
  return 0;
}
