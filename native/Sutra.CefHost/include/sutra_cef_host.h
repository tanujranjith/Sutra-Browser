#pragma once

#include <stdint.h>
#include <windows.h>

#ifdef SUTRA_CEFHOST_EXPORTS
#define SUTRA_CEF_API extern "C" __declspec(dllexport)
#else
#define SUTRA_CEF_API extern "C" __declspec(dllimport)
#endif

// Return nonzero to cancel a decision event such as navigationStarting. The
// return value is ignored for notification-only events.
typedef int(__stdcall* sutra_cef_event_callback)(uint64_t surface_id, const wchar_t* event_json, void* user_data);

// All strings are UTF-16. Calls return zero on success and a nonzero error code
// otherwise. Event JSON contains no credential values.
SUTRA_CEF_API int SutraCefInitialize(const wchar_t* runtime_directory, const wchar_t* subprocess_path, const wchar_t* root_cache_path, sutra_cef_event_callback callback, void* user_data);
SUTRA_CEF_API int SutraCefCreateSurface(uint64_t surface_id, HWND parent, int x, int y, int width, int height, const wchar_t* cache_path, int private_mode);
SUTRA_CEF_API HWND SutraCefGetWindowHandle(uint64_t surface_id);
SUTRA_CEF_API int SutraCefNavigate(uint64_t surface_id, const wchar_t* url);
SUTRA_CEF_API int SutraCefSetBounds(uint64_t surface_id, int x, int y, int width, int height);
SUTRA_CEF_API int SutraCefSetVisible(uint64_t surface_id, int visible);
SUTRA_CEF_API int SutraCefFocus(uint64_t surface_id);
SUTRA_CEF_API int SutraCefGoBack(uint64_t surface_id);
SUTRA_CEF_API int SutraCefGoForward(uint64_t surface_id);
SUTRA_CEF_API int SutraCefReload(uint64_t surface_id);
SUTRA_CEF_API int SutraCefStop(uint64_t surface_id);
SUTRA_CEF_API int SutraCefSetMuted(uint64_t surface_id, int muted);
SUTRA_CEF_API int SutraCefExecuteScript(uint64_t surface_id, int request_id, const wchar_t* script);
SUTRA_CEF_API int SutraCefCapturePng(uint64_t surface_id, int request_id);
SUTRA_CEF_API int SutraCefContinueDownload(uint64_t surface_id, uint32_t download_id, const wchar_t* destination_path, int cancel);
SUTRA_CEF_API int SutraCefSetZoom(uint64_t surface_id, double factor);
SUTRA_CEF_API int SutraCefPrint(uint64_t surface_id);
SUTRA_CEF_API int SutraCefOpenDevTools(uint64_t surface_id);
SUTRA_CEF_API int SutraCefCloseSurface(uint64_t surface_id);
SUTRA_CEF_API int SutraCefShutdown(void);
