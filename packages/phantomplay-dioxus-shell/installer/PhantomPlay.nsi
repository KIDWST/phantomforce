!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

Name "{{product_name}}"
OutFile "{{output_path}}"
Unicode true
{{#if install_mode_per_machine}}
InstallDir "$PROGRAMFILES\{{product_name}}"
{{else}}
InstallDir "$LOCALAPPDATA\Programs\{{product_name}}"
{{/if}}

{{#if install_mode_per_machine}}
RequestExecutionLevel admin
{{else if install_mode_both}}
RequestExecutionLevel admin
{{else}}
RequestExecutionLevel user
{{/if}}

VIProductVersion "{{version}}.0"
VIAddVersionKey "ProductName" "{{product_name}}"
VIAddVersionKey "FileVersion" "{{version}}"
VIAddVersionKey "ProductVersion" "{{version}}"
VIAddVersionKey "FileDescription" "{{short_description}}"
{{#if publisher}}
VIAddVersionKey "CompanyName" "{{publisher}}"
{{/if}}
{{#if copyright}}
VIAddVersionKey "LegalCopyright" "{{copyright}}"
{{/if}}

!define MUI_ABORTWARNING
{{#if installer_icon}}
!define MUI_ICON "{{installer_icon}}"
!define MUI_UNICON "{{installer_icon}}"
{{/if}}
{{#if header_image}}
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "{{header_image}}"
{{/if}}
{{#if sidebar_image}}
!define MUI_WELCOMEFINISHPAGE_BITMAP "{{sidebar_image}}"
{{/if}}

{{#if license}}
!insertmacro MUI_PAGE_LICENSE "{{license}}"
{{/if}}
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
{{#each additional_languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}

Section "Install"
    SetOutPath $INSTDIR

    File "{{main_binary_path}}"

    {{#each staged_files}}
    SetOutPath "$INSTDIR{{#if this.target_dir}}\{{this.target_dir}}{{/if}}"
    File "{{this.source}}"
    {{/each}}

    SetOutPath $INSTDIR
    WriteUninstaller "$INSTDIR\uninstall.exe"

    CreateDirectory "$SMPROGRAMS\{{start_menu_folder}}"
    CreateShortcut "$SMPROGRAMS\{{start_menu_folder}}\{{product_name}}.lnk" "$INSTDIR\{{main_binary_name}}" "" "$INSTDIR\{{main_binary_name}}" 0
    CreateShortcut "$SMPROGRAMS\{{start_menu_folder}}\Uninstall {{product_name}}.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\{{main_binary_name}}" 0
    CreateShortcut "$DESKTOP\{{product_name}}.lnk" "$INSTDIR\{{main_binary_name}}" "" "$INSTDIR\{{main_binary_name}}" 0

    WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "DisplayName" "{{product_name}}"
    WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "DisplayIcon" "$INSTDIR\{{main_binary_name}},0"
    WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "UninstallString" '"$INSTDIR\uninstall.exe"'
    WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
    WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "DisplayVersion" "{{version}}"
    {{#if publisher}}
    WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "Publisher" "{{publisher}}"
    {{/if}}
    WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "InstallLocation" "$INSTDIR"
    WriteRegDWORD SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "NoModify" 1
    WriteRegDWORD SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "NoRepair" 1

    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}" \
        "EstimatedSize" "$0"

    {{#if install_webview}}
    {{webview_install_code}}
    {{/if}}
SectionEnd

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

Section "Uninstall"
    RMDir /r "$INSTDIR"
    RMDir /r "$SMPROGRAMS\{{start_menu_folder}}"
    Delete "$DESKTOP\{{product_name}}.lnk"
    DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{bundle_id}}"
SectionEnd
