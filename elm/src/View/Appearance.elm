module View.Appearance exposing (route, view)

{-| Consumer appearance page, mirroring `src/app/Appearance.tsx`:
look, text size, density, motion switches, and the Advanced shelf
(all looks + background stage). Changes apply on this device.

Fold ownership: prefs/theme/background slots, staging, preview, and
the DOM application live in `App` (ports-side reads/writes); this
module renders the oracle's chrome and hooks.

Documented narrowings: the animated/scene background canvas engine
lands with the backgrounds slice (the stage resolves the same
`resolveBackgroundId` id and previews through the same 160ms
ports-side delay); arrow-key radio travel selects without moving DOM
focus (as on the OnyxOS tabs).
-}

import App exposing (Model, Msg(..), backgroundDirty, renderedBackground)
import Html exposing (Html, a, b, button, details, div, h1, h2, h3, header, label, main_, option, p, section, select, small, span, summary, text)
import Html.Attributes exposing (attribute, class, disabled, href, style, tabindex, title)
import Html.Events exposing (on, onClick, onFocus, onBlur, onMouseEnter, onMouseLeave)
import Json.Decode as Decode
import Prefs
import ThemeLook
import Translate
import View.Studio


radioKey : List String -> String -> Decode.Decoder Msg
radioKey ids current =
    Decode.field "key" Decode.string
        |> Decode.map (\key -> AppearanceRadioKey { ids = ids, current = current, key = key })


fontScaleLabels : List ( Prefs.FontScale, String )
fontScaleLabels =
    [ ( Prefs.FontSmall, "Small" ), ( Prefs.FontMedium, "Medium" ), ( Prefs.FontLarge, "Large" ) ]


densityLabels : List ( Prefs.Density, String )
densityLabels =
    [ ( Prefs.DensityCompact, "Compact" ), ( Prefs.DensityCozy, "Cozy" ), ( Prefs.DensityRoomy, "Roomy" ) ]


clockLabels : List ( Prefs.Clock, String )
clockLabels =
    [ ( Prefs.Clock24h, "24-hour" ), ( Prefs.Clock12h, "12-hour" ) ]


{-| The appearance body. -}
view : Model -> Html Msg
view model =
    let
        looks =
            ThemeLook.buildDefaultLookEntries model.themeId model.customThemes

        lookIds =
            List.map .id looks

        dirty =
            backgroundDirty model
    in
    main_ [ class "ap" ]
        [ div
            [ attribute "aria-hidden" "true"
            , attribute "data-background-canvas" "true"
            , attribute "data-background-id" (renderedBackground model)
            , class "ap-background-host"
            ]
            []
        , header [ class "ap-bar" ]
            [ a [ class "ap-back", href "/app/" ] [ text "← back to app" ]
            , span [ class "ap-tag" ] [ text "Appearance" ]
            , a [ class "ap-home", href "/" ] [ text "home" ]
            ]
        , section [ class "ap-wrap" ]
            [ h1 [ class "ap-h1" ] [ text "Appearance" ]
            , p [ class "ap-lede" ] [ text "Choose a look, text size, and motion. Changes apply on this device." ]
            , p [ class "ap-local-note", attribute "role" "note" ]
                [ span [ attribute "aria-hidden" "true" ] [ text "This device" ]
                , text " Your account and messages are unchanged."
                ]
            , section [ class "ap-group" ]
                [ h2 [ class "ap-glabel" ] [ text "Look" ]
                , div [ class "ap-chips", attribute "role" "radiogroup", attribute "aria-label" "Look" ]
                    (List.map (lookChip model lookIds) looks)
                ]
            , section [ class "ap-group" ]
                [ h2 [ class "ap-glabel" ] [ text "Text size" ]
                , div [ class "ap-chips ap-chips--choices", attribute "role" "radiogroup", attribute "aria-label" "Text size" ]
                    (let
                        ids =
                            List.map (\( scale, _ ) -> Prefs.fontScaleToString scale) fontScaleLabels

                        current =
                            Prefs.fontScaleToString model.prefs.fontScale
                     in
                     List.map
                        (\( scale, label ) ->
                            let
                                value =
                                    Prefs.fontScaleToString scale

                                isOn =
                                    model.prefs.fontScale == scale
                            in
                            button
                                [ Html.Attributes.type_ "button"
                                , class ("ap-chip" ++ (if isOn then " on" else ""))
                                , attribute "role" "radio"
                                , attribute "aria-checked" (if isOn then "true" else "false")
                                , tabindex (if isOn then 0 else -1)
                                , on "keydown" (radioKey ids value)
                                , onClick (AppearanceSetPref { key = "fontScale", value = value })
                                ]
                                [ text label ]
                        )
                        fontScaleLabels
                    )
                ]
            , section [ class "ap-group" ]
                [ h2 [ class "ap-glabel" ] [ text "Density" ]
                , div [ class "ap-chips ap-chips--choices", attribute "role" "radiogroup", attribute "aria-label" "Density" ]
                    (let
                        ids =
                            List.map (\( density, _ ) -> Prefs.densityToString density) densityLabels

                        current =
                            Prefs.densityToString model.prefs.density
                     in
                     List.map
                        (\( density, label ) ->
                            let
                                value =
                                    Prefs.densityToString density

                                isOn =
                                    model.prefs.density == density
                            in
                            button
                                [ Html.Attributes.type_ "button"
                                , class ("ap-chip" ++ (if isOn then " on" else ""))
                                , attribute "role" "radio"
                                , attribute "aria-checked" (if isOn then "true" else "false")
                                , tabindex (if isOn then 0 else -1)
                                , on "keydown" (radioKey ids value)
                                , onClick (AppearanceSetPref { key = "density", value = value })
                                ]
                                [ text label ]
                        )
                        densityLabels
                    )
                ]
            , section [ class "ap-group" ]
                [ h2 [ class "ap-glabel" ] [ text "Timestamps" ]
                , div [ class "ap-chips ap-chips--choices", attribute "role" "radiogroup", attribute "aria-label" "Timestamp format" ]
                    (let
                        ids =
                            List.map (\( clock, _ ) -> Prefs.clockToString clock) clockLabels

                        current =
                            Prefs.clockToString model.prefs.clock
                     in
                     List.map
                        (\( clock, label ) ->
                            let
                                value =
                                    Prefs.clockToString clock

                                isOn =
                                    model.prefs.clock == clock
                            in
                            button
                                [ Html.Attributes.type_ "button"
                                , class ("ap-chip" ++ (if isOn then " on" else ""))
                                , attribute "role" "radio"
                                , attribute "aria-checked" (if isOn then "true" else "false")
                                , tabindex (if isOn then 0 else -1)
                                , on "keydown" (radioKey ids value)
                                , onClick (AppearanceSetPref { key = "clock", value = value })
                                ]
                                [ text label ]
                        )
                        clockLabels
                    )
                ]
            , section [ class "ap-group" ]
                [ h2 [ class "ap-glabel" ] [ text "Privacy" ]
                , div [ class "ap-choice-toggles" ]
                    [ privacySwitch "e2eeDms" model.prefs.e2eeDms "End-to-end encrypt direct messages" "When the other person's app supports it, DMs are sealed on your device."
                    , privacySwitch "linkPreviews" model.prefs.linkPreviews "Preview web links" "Show link details fetched through this server."
                    , privacySwitch "httpsOnly" model.prefs.httpsOnly "Only unfurl https links" "When on, plain http links never fetch a preview or media unfurl."
                    ]
                ]
            , languageTools model
            , section [ class "ap-group" ]
                [ h2 [ class "ap-glabel" ] [ text "Motion and data" ]
                , div [ class "ap-choice-toggles" ]
                    [ button
                        [ Html.Attributes.type_ "button"
                        , class "ap-choice-toggle"
                        , attribute "role" "switch"
                        , attribute "aria-checked" (if model.prefs.reduceMotion then "true" else "false")
                        , onClick AppearanceToggleReduceMotion
                        ]
                        [ span [] [ text "Reduce motion" ]
                        , b [] [ text (if model.prefs.reduceMotion then "On" else "Off") ]
                        ]
                    , button
                        [ Html.Attributes.type_ "button"
                        , class "ap-choice-toggle"
                        , attribute "role" "switch"
                        , attribute "aria-checked" (if model.sceneMotion == Prefs.SceneOff then "true" else "false")
                        , onClick AppearanceToggleSceneMotion
                        ]
                        [ span [] [ text "Use less data" ]
                        , b [] [ text (if model.sceneMotion == Prefs.SceneOff then "On" else "Off") ]
                        ]
                    ]
                ]
            , details [ class "ap-studio", attribute "data-testid" "appearance-advanced" ]
                [ summary []
                    [ span [] [ text "Advanced" ]
                    , b [] [ text "More looks, backgrounds, and Theme Studio" ]
                    , small [] [ text "Optional tools for people who want finer control." ]
                    ]
                , div [ class "ap-studio__body" ]
                    [ section [ class "ap-group" ]
                        [ h2 [ class "ap-glabel" ] [ text "All looks" ]
                        , div [ class "ap-chips", attribute "role" "radiogroup", attribute "aria-label" "All looks" ]
                            (List.map (themeChip model) (ThemeLook.themeMeta |> List.map (\meta -> { id = meta.id, label = meta.label, title = meta.description, swatch = meta.swatch })) ++ List.map (themeChip model) (List.map (\custom -> { id = custom.id, label = custom.name, title = "Saved look", swatch = [ "var(--lapis)", "var(--gold)", "var(--shu)" ] }) model.customThemes))
                        ]
                    , section [ class "ap-group ap-background-stage" ]
                        [ div [ class "ap-background-stage__heading" ]
                            [ h2 [ class "ap-glabel" ] [ text "Background" ]
                            , span [] [ text (if dirty then "Preview only" else "Saved") ]
                            ]
                        , p [ class "ap-ghint" ] [ text "Focus or hover previews a background. Selection is staged until you apply." ]
                        , backgroundPicker model
                        , div [ class "ap-background-actions" ]
                            [ button
                                [ Html.Attributes.type_ "button"
                                , class "ap-action ap-action--quiet"
                                , disabled (not dirty)
                                , onClick AppearanceCancelBackground
                                ]
                                [ text "Cancel preview" ]
                            , button
                                [ Html.Attributes.type_ "button"
                                , class "ap-action ap-action--apply"
                                , disabled (not dirty)
                                , onClick AppearanceApplyBackground
                                ]
                                [ text "Apply background" ]
                            ]
                        ]
                    , View.Studio.studio model
                    ]
                ]
            ]
        ]


lookChip : Model -> List String -> ThemeLook.LookEntry -> Html Msg
lookChip model ids entry =
    let
        isOn =
            model.themeId == entry.id
    in
    button
        [ Html.Attributes.type_ "button"
        , class ("ap-theme-chip" ++ (if isOn then " ap-theme-chip--on" else "") ++ (if entry.extra then " ap-theme-chip--custom" else ""))
        , attribute "role" "radio"
        , attribute "aria-checked" (if isOn then "true" else "false")
        , attribute "aria-label" (entry.label ++ " look")
        , title entry.title
        , tabindex (if isOn then 0 else -1)
        , style "min-height" "44px"
        , style "touch-action" "manipulation"
        , on "keydown" (radioKey ids entry.id)
        , onClick (AppearanceSetTheme { id = entry.id })
        ]
        [ span [ class "ap-theme-swatch", attribute "aria-hidden" "true" ]
            (List.map (\color -> span [ style "background" color ] []) entry.swatch)
        , span [ class "ap-theme-name" ] [ text entry.label ]
        ]


{-| Local language tools (mirroring the PreferencesPanel
section: the translator readiness row plus, when available, the
translation-language select over the curated targets — with the
effective target surfaced first when it is not curated, so the
shown selection always matches what captions translate to. The
caption-transcript row has no Elm counterpart yet). -}
languageTools : Model -> Html Msg
languageTools model =
    let
        effective =
            Translate.resolveTranslationTarget model.translationTarget model.translationBrowserLang

        options =
            if Translate.isTranslationTarget effective then
                Translate.translationTargets

            else
                effective :: Translate.translationTargets
    in
    section [ class "ap-group" ]
        [ h2 [ class "ap-glabel" ] [ text "Local language tools" ]
        , p [ class "ap-desc" ]
            [ text "Caption and translation handoffs stay local-first. Onyx labels what can run on this device and refuses hidden external translation." ]
        , div [ class "ap-readiness-row" ]
            [ span [ class "ap-readiness-state" ] [ text (if model.translationAvailable then "available" else "unavailable") ]
            , span [ class "ap-readiness-main" ]
                [ span [ class "ap-readiness-title" ] [ text (Translate.readinessLabel model.translationAvailable) ]
                , small [] [ text (Translate.readinessDetail model.translationAvailable effective) ]
                ]
            ]
        , if model.translationAvailable then
            div [ class "ap-translation-target" ]
                [ label [ class "ap-label" ] [ text "Translation language" ]
                , select
                    [ on "change" (Decode.at [ "target", "value" ] Decode.string |> Decode.map (\code -> TranslationTargetSet { target = code }))
                    ]
                    (List.map
                        (\code -> option [ Html.Attributes.value code, Html.Attributes.selected (code == effective) ] [ text (Translate.languageLabel code) ])
                        options
                    )
                , p [ class "ap-desc" ]
                    [ text "On-device target for the message Translate action. Text is translated in this browser and never sent to an external endpoint." ]
                ]

          else
            text ""
        ]


{-| A privacy switch (mirrors the PreferencesPanel toggles: the
same titles, short-form descriptions, and On/Off readout). -}
privacySwitch : String -> Bool -> String -> String -> Html Msg
privacySwitch key isOn title hint =
    button
        [ Html.Attributes.type_ "button"
        , class "ap-choice-toggle"
        , attribute "role" "switch"
        , attribute "aria-checked"
            (if isOn then
                "true"

             else
                "false"
            )
        , attribute "aria-label" title
        , onClick (AppearanceSetPref { key = key, value = if isOn then "false" else "true" })
        ]
        [ span [] [ text title, small [] [ text hint ] ]
        , b [] [ text (if isOn then "On" else "Off") ]
        ]


themeChip :
    Model
    -> { id : String, label : String, title : String, swatch : List String }
    -> Html Msg
themeChip model item =
    let
        isOn =
            model.themeId == item.id

        ids =
            List.map .id ThemeLook.themeMeta ++ List.map .id model.customThemes
    in
    button
        [ Html.Attributes.type_ "button"
        , class ("ap-chip ap-chip--theme" ++ (if isOn then " on" else ""))
        , attribute "role" "radio"
        , attribute "aria-checked" (if isOn then "true" else "false")
        , tabindex (if isOn then 0 else -1)
        , on "keydown" (radioKey ids item.id)
        , onClick (AppearanceSetTheme { id = item.id })
        ]
        [ span [ class "ap-swatch", attribute "aria-hidden" "true" ]
            (List.map (\color -> span [ style "background" color ] []) item.swatch)
        , text item.label
        ]


backgroundPicker : Model -> Html Msg
backgroundPicker model =
    div [ class "background-picker", attribute "role" "radiogroup", attribute "aria-label" "Background" ]
        (List.map
            (\( groupLabel, options ) ->
                section [ class "background-picker__group", attribute "aria-label" groupLabel ]
                    [ h3 [ class "background-picker__heading" ] [ text groupLabel ]
                    , div [ class "background-picker__grid" ]
                        (List.map (backgroundOption model) options)
                    ]
            )
            ThemeLook.backgroundGroups
        )


backgroundKindKey : ThemeLook.BackgroundKind -> String
backgroundKindKey kind =
    case kind of
        ThemeLook.BackgroundAnimated ->
            "animated"

        ThemeLook.BackgroundSolid ->
            "solid"

        ThemeLook.BackgroundScene ->
            "scene"


backgroundOption : Model -> ThemeLook.BackgroundOption -> Html Msg
backgroundOption model option =
    let
        isOn =
            model.backgroundCandidate == option.id

        label =
            if option.id == ThemeLook.autoBackgroundId then
                "Auto — theme-matched background"

            else
                option.label ++ ", " ++ backgroundKindKey option.kind ++ ", " ++ option.character ++ ", " ++ option.detail ++ " detail"
    in
    button
        [ Html.Attributes.type_ "button"
        , class ("background-picker__card" ++ (if isOn then " background-picker__card--selected" else ""))
        , attribute "role" "radio"
        , attribute "aria-checked" (if isOn then "true" else "false")
        , tabindex (if isOn then 0 else -1)
        , attribute "aria-label" label
        , attribute "data-background-id" option.id
        , attribute "data-kind" (backgroundKindKey option.kind)
        , attribute "data-detail" option.detail
        , style "min-height" "44px"
        , style "touch-action" "manipulation"
        , onFocus (AppearancePreviewBackground { id = option.id })
        , onBlur (AppearancePreviewBackground { id = "" })
        , onMouseEnter (AppearancePreviewBackground { id = option.id })
        , onMouseLeave (AppearancePreviewBackground { id = "" })
        , on "keydown" (radioKey (ThemeLook.backgroundOptions |> List.map .id) option.id)
        , onClick (AppearanceStageBackground { id = option.id })
        ]
        [ span [ class "background-picker__swatch", attribute "aria-hidden" "true" ] [ Html.i [] [], Html.i [] [], Html.i [] [] ]
        , span [ class "background-picker__copy" ] [ b [] [ text option.label ], small [] [ text option.character ] ]
        , span [ class "background-picker__meta" ]
            [ text
                (if option.id == ThemeLook.autoBackgroundId then
                    "auto"

                 else
                    backgroundKindKey option.kind ++ " · " ++ option.detail
                )
            ]
        ]


{-| The appearance route: a standalone page (not the public frame —
the page renders its own animated shell, so the frame's chrome would
double the header). -}
route : Model -> List (Html Msg)
route model =
    [ view model ]
