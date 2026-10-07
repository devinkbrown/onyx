module View.Download exposing (route, view)

{-| Public download page, mirroring `src/routes/Download.tsx`: browser
first, unsigned native packages below, macOS as a combined coming-soon
surface with no fake download controls.

Fold ownership: the catalog fetch, per-lane `.sha256` sidecar fetches,
and per-button copy state live in `App` (`requestDownloadCatalog`,
`HttpResult`, `DownloadCopyRequest`, `ClipboardResult` with echoed
tags, `Tick` revert); this module renders the oracle's voice, chrome,
and `data-testid` hooks. The `/install` alias renders the same page
with the "Same page as Download" kicker.
-}

import App exposing (Model, Msg(..), downloadAvailabilityFor, downloadCatalogState, downloadCopyState, downloadShaFor, downloadShaLoading, isInstallPath)
import Download
import Html exposing (Html, a, article, aside, button, code, div, h1, h2, h3, h4, li, p, pre, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, download, href, id)
import Html.Events exposing (onClick)
import View.PublicFrame exposing (frame)


contextLine : Html Msg
contextLine =
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text "This device" ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text "Browser first" ]
        ]


{-| The download body. -}
view : Model -> Html Msg
view model =
    let
        installGuide =
            isInstallPath model.navPath
    in
    div [ class "ui-root r data-page dl-page", attribute "data-testid" "download-page" ]
        [ section [ class "r-wrap data-hero dl-hero", attribute "aria-labelledby" "download-heading" ]
            [ p [ class "dl-kicker" ] [ text (if installGuide then "Same page as Download" else "This device") ]
            , h1 [ id "download-heading" ] [ text "Get Onyx on this device" ]
            , p [ class "dl-lede" ] [ text "Open it in the browser. That is the main door." ]
            , p [ class "sub" ]
                [ text "Supporting browsers can keep Onyx here as an installed app — same rooms, messages, and calls. Desktop packages exist if you want them. Desktop packages are optional and unsigned." ]
            , div [ class "dl-cta" ]
                [ a [ class "r-btn primary", href "/app/", attribute "data-testid" "dl-open-browser" ]
                    [ text "Open Onyx in the browser" ]
                , a [ class "r-btn ghost", href "#keep-here" ] [ text "Keep it on this device" ]
                ]
            ]
        , section [ id "keep-here", class "r-wrap r-section dl-browser-section", attribute "aria-labelledby" "browser-heading" ]
            [ div [ class "dl-section-intro" ]
                [ p [ class "dl-kicker" ] [ text "Browser first" ]
                , h2 [ id "browser-heading", class "dl-section-title" ] [ text "Keep Onyx on this device" ]
                ]
            , div [ class "dl-browser-grid" ]
                [ div [ class "dl-browser" ]
                    [ p []
                        [ text "Open Onyx, then use your browser's "
                        , strong [] [ text "Install app" ]
                        , text " or "
                        , strong [] [ text "Add to Home Screen" ]
                        , text " control. You get the same rooms, people, and calls — no store badge required."
                        ]
                    , p [] [ text "Safari on iPhone uses Add to Home Screen. Chrome, Edge, and other supporting browsers offer an install prompt once the app is open." ]
                    , a [ class "r-btn primary", href "/app/" ] [ text "Join in the browser" ]
                    ]
                , aside [ class "dl-honesty", attribute "aria-labelledby" "honesty-heading" ]
                    [ h2 [ id "honesty-heading", class "dl-section-title" ] [ text "What this is — and is not" ]
                    , ul []
                        [ li []
                            [ strong [] [ text "Is:" ]
                            , text " unsigned zip/tar.gz packages with SHA-256 sidecars and honesty notices (Windows Native SDK zip; Linux Native SDK tar.gz; FreeBSD/OpenBSD Zig-native hosts with install.sh)."
                            ]
                        , li []
                            [ strong [] [ text "Is not:" ]
                            , text " codesigned, notarized, virus-scanned, store-packaged, auto-updating, or a signed multi-platform installer suite. macOS DMGs are not published yet — no fake download buttons."
                            ]
                        , li []
                            [ strong [] [ text "Runtime / GUI launch" ]
                            , text " is not claimed from the Linux release host — package layout and checksums only. Windows runtime is not verified on real Windows here."
                            ]
                        , li []
                            [ strong [] [ text "macOS:" ]
                            , text " Intel x86_64 and Apple Silicon arm64 native WKWebView packages are planned as separate arch lanes, produced only on genuine matching-arch Darwin. Until they ship, there is no DMG, sidecar, or install path on this page."
                            ]
                        , li []
                            [ strong [] [ text "Browser first:" ]
                            , text " most people should "
                            , a [ href "/app/" ] [ text "open the browser app" ]
                            , text " — including on Mac today. Supporting browsers can put Onyx on the Home Screen or in its own window. No store."
                            ]
                        ]
                    ]
                ]
            ]
        , artifactsSection model
        , section [ class "r-wrap r-section", attribute "aria-labelledby" "verify-heading" ]
            [ div [ class "dl-verify" ]
                [ h2 [ id "verify-heading" ] [ text "Verify a download" ]
                , pre [ class "dl-pre" ] [ text Download.verifyPreBlock ]
                , p [ class "dl-note" ]
                    [ text "Compare the hash on this page (when staged) with the "
                    , code [] [ text ".sha256" ]
                    , text " file next to the archive. Onyx does not claim third-party virus-free status or code signing for these artifacts."
                    ]
                ]
            ]
        ]


artifactsSection : Model -> Html Msg
artifactsSection model =
    section [ class "r-wrap r-section dl-artifacts-section", attribute "aria-labelledby" "download-lanes-heading" ]
        [ div [ class "dl-section-intro" ]
            [ p [ class "dl-kicker" ] [ text "Native artifacts" ]
            , h2 [ id "download-lanes-heading", class "dl-section-title" ] [ text "Desktop packages" ]
            , p [ class "dl-below-fold" ]
                [ text "Optional native builds for Windows, Linux, FreeBSD, and OpenBSD. Every published artifact is unsigned. macOS Intel and Apple Silicon packages are coming soon — built on real Macs only, never fabricated here." ]
            ]
        , div
            [ class "dl-catalog-receipt"
            , attribute "data-catalog-state" (catalogStateKey model)
            , attribute "role" "status"
            , attribute "aria-label" "Download catalog status"
            , attribute "aria-live" "polite"
            , attribute "aria-atomic" "true"
            ]
            [ span [ class "dl-catalog-receipt__marker", attribute "aria-hidden" "true" ] []
            , span [] [ text (Download.catalogReceipt (downloadCatalogState model)) ]
            ]
        , div [ class "dl-grid dl-artifact-list", attribute "role" "list", attribute "aria-label" "Native download artifacts" ]
            (List.map (laneCard model) Download.downloadCards ++ [ macosCard ])
        ]


catalogStateKey : Model -> String
catalogStateKey model =
    case downloadCatalogState model of
        Download.CatalogLoading ->
            "loading"

        Download.CatalogReady ->
            "ready"

        Download.CatalogErrored ->
            "errored"


availabilityKey : Download.Availability -> String
availabilityKey availability =
    case availability of
        Download.DlLoading ->
            "loading"

        Download.DlAvailable ->
            "available"

        Download.DlUnavailable ->
            "unavailable"

        Download.DlUnknown ->
            "unknown"


{-| One native artifact card (mirroring the oracle `LaneCard`).
-}
laneCard : Model -> Download.DownloadCard -> Html Msg
laneCard model card =
    let
        lane =
            Download.activeLaneId card.lane

        availability =
            downloadAvailabilityFor model lane

        stateKey =
            availabilityKey availability

        hash =
            downloadShaFor model lane

        shaLoading =
            downloadShaLoading model lane

        steps =
            String.join "\n" (Download.installSteps card.lane)

        factsRuntime =
            if card.runtimeIncluded then
                "Runtime included"

            else if card.hasInstallScript then
                "Runtime (auto via install.sh)"

            else
                "Runtime requirement"
    in
    article
        [ class "dl-card dl-artifact"
        , attribute "role" "listitem"
        , attribute "data-testid" ("dl-card-" ++ lane)
        , attribute "data-state" stateKey
        ]
        [ div [ class "dl-card-head" ]
            [ span [ class "label" ] [ text card.osLabel ]
            , span
                [ class "dl-status"
                , attribute "data-testid" ("dl-status-" ++ lane)
                , attribute "data-state" stateKey
                , attribute "role" "status"
                ]
                [ text (Download.availabilityLabel availability) ]
            ]
        , div [ class "dl-artifact-summary" ]
            [ h3 [] [ text card.title ]
            , p [] [ text card.summary ]
            , ul [ class "dl-facts" ]
                ([ li []
                    [ strong [] [ text factsRuntime ]
                    , text (" " ++ String.join " + " card.primaryPackages)
                    ]
                 , li []
                    ([ strong [] [ text "Layout" ], text " " ]
                        ++ layoutLines card
                    )
                 , li []
                    [ strong [] [ text "Signing" ]
                    , text (" " ++ Download.signingLabel card.archiveExt)
                    ]
                 ]
                )
            ]
        , div [ class "dl-artifact-details" ]
            [ div [ class "dl-actions" ]
                (if availability == Download.DlAvailable then
                    [ a
                        [ class "r-btn primary"
                        , attribute "data-testid" ("dl-download-" ++ lane)
                        , href card.archiveUrl
                        , download card.archiveName
                        ]
                        [ text (Download.archiveButtonLabel card.archiveExt) ]
                    , a
                        [ class "r-btn ghost"
                        , attribute "data-testid" ("dl-notice-" ++ lane)
                        , href card.noticeUrl
                        ]
                        [ text "Honesty notice" ]
                    , a
                        [ class "r-btn ghost"
                        , attribute "data-testid" ("dl-sha256-" ++ lane)
                        , href card.sha256Url
                        ]
                        [ text "SHA-256 file" ]
                    ]

                 else
                    [ p [ class "dl-checksum-missing", attribute "role" "status" ]
                        [ text
                            (if availability == Download.DlLoading then
                                "Checking the staged catalog before showing download controls."

                             else if availability == Download.DlUnavailable then
                                "This native artifact is not published for this lane. Archive, notice, and checksum links are withheld."

                             else
                                "Artifact availability could not be confirmed. Download controls are withheld until the catalog is available."
                            )
                        ]
                    ]
                )
            , div [ class "dl-checksum", attribute "data-testid" ("dl-checksum-" ++ lane) ]
                [ span [ class "dl-checksum-label" ] [ text "SHA-256" ]
                , if availability /= Download.DlAvailable then
                    p [ class "dl-checksum-missing" ]
                        [ text
                            (if availability == Download.DlLoading then
                                "Checksum will be checked after artifact availability is resolved."

                             else if availability == Download.DlUnavailable then
                                "No checksum is published because this artifact is unavailable."

                             else
                                "Checksum is unavailable because artifact availability could not be confirmed."
                            )
                        ]

                  else
                    case hash of
                        Just h ->
                            div [ class "dl-checksum-row" ]
                                [ code [ class "dl-hash", attribute "data-testid" ("dl-hash-" ++ lane) ] [ text h ]
                                , copyButton model ("hash-" ++ lane) "Copy"
                                ]

                        Nothing ->
                            p [ class "dl-checksum-missing" ]
                                [ text
                                    (if shaLoading then
                                        "Loading the published SHA-256 sidecar."

                                     else
                                        "The archive is published, but its SHA-256 sidecar is not currently available."
                                    )
                                ]
                ]
            , div [ class "dl-install" ]
                [ h4 []
                    [ text
                        (if card.hasInstallScript then
                            "Install on " ++ card.osLabel

                         else
                            "Use on " ++ card.osLabel
                        )
                    ]
                , pre [ class "dl-pre", attribute "data-testid" ("dl-install-" ++ lane) ] [ text steps ]
                , copyButton model
                    ("install-" ++ lane)
                    (if card.hasInstallScript then
                        "Copy install steps"

                     else
                        "Copy steps"
                    )
                , if card.hasInstallScript then
                    p [ class "dl-note" ]
                        [ text "Root and network are required only when "
                        , code [] [ text "install.sh" ]
                        , text (" auto-installs system packages via " ++ Maybe.withDefault "" card.packageManager ++ ". Use ")
                        , code [] [ text "--prefix" ]
                        , text " and "
                        , code [] [ text "--no-deps" ]
                        , text " for a non-root tree. The script never curl-pipes remote code."
                        ]

                  else
                    p [ class "dl-note" ]
                        [ text "This package is "
                        , strong [] [ text "unsigned" ]
                        , text ". Extract and run from the package tree. Onyx does not claim codesign, notarization, virus-free status, or GUI launch verification for this lane."
                        ]
                ]
            ]
        ]


layoutLines : Download.DownloadCard -> List (Html Msg)
layoutLines card =
    let
        laneLines =
            case card.lane of
                Download.Windows ->
                    [ text "package root bin/onyx.exe + WebView2Loader.dll + resources" ]

                Download.Linux ->
                    [ text "package root bin/onyx + resources/dist" ]

                _ ->
                    []
    in
    laneLines
        ++ (if card.hasInstallScript then
                [ text "PREFIX/bin/onyx + PREFIX/resources (default PREFIX=/usr/local)" ]

            else
                []
           )


{-| A copy button with per-key state (mirroring the oracle `CopyButton`
`idle` / `copied` / `failed` states and the 1600ms copied revert, which
lives in the `App` `Tick` fold).
-}
copyButton : Model -> String -> String -> Html Msg
copyButton model key idleLabel =
    let
        ( label, stateKey ) =
            case downloadCopyState model key of
                App.DlCopyCopied _ ->
                    ( "Copied", "copied" )

                App.DlCopyFailed ->
                    ( "Copy failed", "failed" )

                App.DlCopyIdle ->
                    ( idleLabel, "idle" )
    in
    button
        [ Html.Attributes.type_ "button"
        , class "dl-copy"
        , attribute "data-testid" ("dl-copy-" ++ key)
        , attribute "data-state" stateKey
        , attribute "aria-live" "polite"
        , onClick (DownloadCopyRequest { key = key })
        ]
        [ text label ]


{-| Combined macOS Intel + Apple Silicon card: polished coming-soon, no
dead downloads (mirroring the oracle `MacosComingSoonCard`).
-}
macosCard : Html Msg
macosCard =
    let
        mac =
            Download.macosCard
    in
    article
        [ class "dl-card dl-artifact dl-card--soon"
        , attribute "role" "listitem"
        , attribute "data-testid" "dl-card-macos"
        , attribute "data-state" "coming-soon"
        ]
        [ div [ class "dl-card-head" ]
            [ span [ class "label" ] [ text mac.osLabel ]
            , span [ class "dl-status", attribute "data-testid" "dl-macos-status" ] [ text mac.statusLabel ]
            ]
        , div [ class "dl-artifact-summary" ]
            [ h3 [] [ text mac.title ]
            , p [] [ text mac.summary ]
            , ul [ class "dl-facts" ]
                [ li [] [ strong [] [ text "Runtime (planned)" ], text (" " ++ mac.runtime) ]
                , li [] [ strong [] [ text "Package (planned)" ], text (" " ++ mac.plannedPackage) ]
                , li []
                    [ strong [] [ text "Status" ]
                    , text " No public DMG, SHA-256 sidecar, or honesty notice is linked until genuine Darwin builds ship."
                    ]
                ]
            ]
        , div [ class "dl-artifact-details" ]
            [ ul [ class "dl-soon-arches", attribute "data-testid" "dl-macos-arches", attribute "aria-label" "Planned macOS architectures" ]
                (List.map
                    (\arch ->
                        li [ class "dl-soon-arch", attribute "data-testid" ("dl-macos-arch-" ++ arch.arch) ]
                            [ strong [] [ text arch.label ]
                            , span [] [ text arch.note ]
                            ]
                    )
                    mac.arches
                )
            , div [ class "dl-actions" ]
                [ a [ class "r-btn ghost", attribute "data-testid" "dl-macos-open-app", href "/app/" ]
                    [ text "Open Onyx in browser" ]
                ]
            , p [ class "dl-note", attribute "data-testid" "dl-macos-honesty" ]
                [ text (mac.honesty ++ " Supporting browsers can put Onyx on the Home Screen or in its own window. No store. Same rooms, messages, and calls without a native package.") ]
            ]
        ]


{-| The download route. -}
route : Model -> List (Html Msg)
route model =
    [ frame model "/download/" "Get Onyx" (Just contextLine) [ view model ] ]
