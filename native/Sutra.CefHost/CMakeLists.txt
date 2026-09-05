cmake_minimum_required(VERSION 3.21)
project(SutraCefHost LANGUAGES CXX)

if(NOT DEFINED CEF_ROOT)
  message(FATAL_ERROR "Set CEF_ROOT to the extracted official CEF binary distribution.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CEF_RUNTIME_LIBRARY_FLAG "/MD")
set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CEF_ROOT}/cmake")

find_package(CEF REQUIRED)
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)
ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")

add_library(Sutra.CefHost SHARED src/sutra_cef_host.cc)
SET_LIBRARY_TARGET_PROPERTIES(Sutra.CefHost)
target_include_directories(Sutra.CefHost PUBLIC include ${CEF_ROOT})
add_dependencies(Sutra.CefHost libcef_dll_wrapper)
target_link_libraries(Sutra.CefHost PRIVATE libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS})
target_compile_definitions(Sutra.CefHost PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX SUTRA_CEFHOST_EXPORTS)

add_executable(Sutra.CefSubprocess WIN32 subprocess/main.cc)
SET_EXECUTABLE_TARGET_PROPERTIES(Sutra.CefSubprocess)
target_include_directories(Sutra.CefSubprocess PRIVATE ${CEF_ROOT})
add_dependencies(Sutra.CefSubprocess libcef_dll_wrapper)
target_link_libraries(Sutra.CefSubprocess PRIVATE libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS})
target_compile_definitions(Sutra.CefSubprocess PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)

set_target_properties(Sutra.CefHost Sutra.CefSubprocess PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/runtime"
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/runtime")
