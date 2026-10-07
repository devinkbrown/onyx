module View.Studio exposing (studio)

{-| Theme Studio, mirroring `src/theme/ThemeStudio.tsx`: header with the
modified badge, the simple Choose-a-look shelf, the generative palette
factory (generate + adjust), the base-theme grid, the background grid,
the tabbed token editor, the live mock preview, the WCAG audit, and the
save/export/import/share footer.

Fold ownership: every knob sends the same `Studio*` message the fold
already handles (`App`); live token edits apply unvalidated and the save
boundary validates, exactly like the oracle. This module renders the
oracle's chrome and hooks.

Documented narrowings: hover tooltips keep their chrome (the
`onyx-tooltip` wrapper) but open ports-side — Elm has no hover intent
without JS; tab arrow travel moves selection through `studioTab`
without moving DOM focus (as on the OnyxOS tabs); the studio reuses the
page's `AppearanceRadioKey` travel shape for its look chips.
-}

import App exposing (Model, Msg(..), studioResolvedTokens)
import Dict exposing (Dict)
import Html exposing (Html, aside, button, code, div, footer, h2, header, input, label, li, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, id, placeholder, step, style, tabindex, title, value)
import Html.Events exposing (on, onClick, onInput)
import Json.Decode as Decode
import Studio
import Theme
import ThemeLook


{-| Arrow-key travel for the studio's radio chips (same shape as the
appearance page: arrows move selection, focus stays put). -}
radioKey : List String -> String -> Decode.Decoder Msg
radioKey ids current =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                case moveRadio ids current key of
                    Just id ->
                        Decode.succeed (AppearanceSetTheme { id = id })

                    Nothing ->
                        Decode.fail "unclaimed key"
            )


moveRadio : List String -> String -> String -> Maybe String
moveRadio ids current key =
    let
        step =
            if key == "ArrowRight" || key == "ArrowDown" then
                1

            else if key == "ArrowLeft" || key == "ArrowUp" then
                -1

            else
                0

        indexed =
            List.indexedMap Tuple.pair ids

        currentIndex =
            indexed
                |> List.filter (\( _, id ) -> id == current)
                |> List.head
                |> Maybe.map Tuple.first
                |> Maybe.withDefault 0

        count =
            List.length ids
    in
    if step == 0 || count == 0 then
        Nothing

    else
        indexed
            |> List.filter (\( i, _ ) -> i == modBy count (currentIndex + step))
            |> List.head
            |> Maybe.map Tuple.second


{-| Arrow travel between token-group tabs. -}
tabKey : List String -> String -> Decode.Decoder Msg
tabKey ids current =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                case moveRadio ids current key of
                    Just id ->
                        Decode.succeed (StudioTabSelect { id = id })

                    Nothing ->
                        Decode.fail "unclaimed key"
            )


{-| Enter confirms the save name, Escape backs out (mirroring the
save-row key handler). -}
saveKey : Decode.Decoder Msg
saveKey =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                if key == "Enter" then
                    Decode.succeed StudioConfirmSave

                else if key == "Escape" then
                    Decode.succeed StudioCancelSave

                else
                    Decode.fail "unclaimed key"
            )


{-| Session edits over the base (mirroring `hasOverrides`). -}
hasOverrides : Model -> Bool
hasOverrides model =
    not (Dict.isEmpty model.studioOverrides)


{-| The Adjust knobs are off identity (mirroring `adjustDirty`). -}
adjustDirty : Model -> Bool
adjustDirty model =
    not (Studio.isAdjustIdentity model.studioAdjust)


{-| Anything the reset button would clear (mirroring `factoryDirty`:
armed live-regen, an adjust in flight, or a seed off the default). -}
factoryDirty : Model -> Bool
factoryDirty model =
    model.studioFactoryArmed || adjustDirty model || model.studioSeed /= Theme.defaultSeed


{-| The saved custom theme backing a share link (mirroring
`shareableTheme`: only a saved custom theme can be shared). -}
shareableCustom : Model -> Maybe Studio.CustomTheme
shareableCustom model =
    if Studio.isCustomThemeId model.themeId then
        List.filter (\custom -> custom.id == model.themeId) model.studioCustoms
            |> List.head

    else
        Nothing


{-| Header description for the active theme (mirroring
`activeThemeMeta().description`). -}
headerDesc : Model -> String
headerDesc model =
    case List.filter (\custom -> custom.id == model.themeId) model.studioCustoms |> List.head of
        Just custom ->
            case ThemeLook.themeMeta |> List.filter (\meta -> meta.id == custom.base) |> List.head of
                Just base ->
                    "Your custom theme, based on " ++ base.label ++ "."

                Nothing ->
                    "Your custom theme."

        Nothing ->
            ThemeLook.themeMeta
                |> List.filter (\meta -> meta.id == model.themeId)
                |> List.head
                |> Maybe.map .description
                |> Maybe.withDefault "Your custom theme."


{-| `onyx-button` classes (mirroring the `Button` primitive). -}
btn : String -> String -> List (Html.Attribute Msg) -> List (Html Msg) -> Html Msg
btn variant size attrs kids =
    button
        ([ Html.Attributes.type_ "button"
         , class ("onyx-button onyx-button--" ++ variant ++ " onyx-button--" ++ size)
         ]
            ++ attrs
        )
        kids


{-| Hover-tooltip chrome (mirroring the `Tooltip` wrapper; the bubble
itself opens ports-side). -}
tip : String -> Html Msg -> Html Msg
tip placement kid =
    span [ class "onyx-tooltip", attribute "data-placement" placement ] [ kid ]


{-| The studio root. -}
studio : Model -> Html Msg
studio model =
    div [ class "ts-studio", attribute "data-testid" "theme-studio" ]
        [ header [ class "ts-header" ]
            [ div [ class "ts-header__title-row" ]
                ([ span [ class "ts-eyebrow" ] [ text "// Theme Studio" ] ]
                    ++ (if hasOverrides model then
                            [ span [ class "ts-badge ts-badge--modified" ] [ text "modified" ] ]

                        else
                            []
                       )
                )
            , p [ class "ts-header__desc" ] [ text (headerDesc model) ]
            ]
        , simpleLook model
        , factory model
        , baseSection model
        , backgroundSection model
        , div [ class "ts-body" ]
            [ editor model
            , aside [ class "ts-preview-pane", attribute "aria-label" "Live preview" ]
                [ span [ class "ts-eyebrow" ] [ text "// Preview" ]
                , preview
                , audit model
                ]
            ]
        , studioFooter model
        ]


{-| Simple Choose-a-look shelf (the studio's own `PublicLookPicker`). -}
simpleLook : Model -> Html Msg
simpleLook model =
    let
        looks =
            ThemeLook.buildDefaultLookEntries model.themeId model.customThemes

        lookIds =
            List.map .id looks
    in
    section [ class "ts-section ts-simple-look", attribute "aria-labelledby" "ts-simple-look-label" ]
        [ div [ class "ts-section__heading-row" ]
            [ div []
                [ h2 [ class "ts-section__heading", id "ts-simple-look-label" ] [ text "Choose a look" ]
                , p [ class "ts-section__intro" ] [ text "Start with a ready-to-use Onyx look. You can fine-tune it later." ]
                ]
            , span [ class "ts-simple-look__hint" ] [ text "Simple controls" ]
            ]
        , div
            [ class "ts-public-look-picker"
            , attribute "role" "radiogroup"
            , attribute "aria-label" "Choose a look"
            , style "touch-action" "manipulation"
            ]
            (List.map (simpleChip lookIds model.themeId) looks)
        ]


simpleChip : List String -> String -> ThemeLook.LookEntry -> Html Msg
simpleChip ids activeId entry =
    let
        isOn =
            activeId == entry.id
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
        , span [ class "ap-theme-swatch", attribute "aria-hidden" "true" ]
            (List.map (\color -> span [ style "background" color ] []) entry.swatch)
        , span [ class "ap-theme-name" ] [ text entry.label ]
        ]


{-| A labelled range knob shared by the seed and adjust columns
(mirroring `FactorySlider`). -}
rangeSlider :
    { id : String
    , label : String
    , min : String
    , max : String
    , step : String
    , value : String
    , badge : String
    , testid : String
    , onValue : String -> Msg
    , live : Bool
    }
    -> Html Msg
rangeSlider cfg =
    div [ class "ts-token-control" ]
        [ label [ class "ts-token-label", for cfg.id ]
            [ text cfg.label
            , span [ class "ts-token-badge" ] [ text cfg.badge ]
            ]
        , input
            ([ Html.Attributes.type_ "range"
             , id cfg.id
             , class "ts-token-range"
             , Html.Attributes.min cfg.min
             , Html.Attributes.max cfg.max
             , step cfg.step
             , value cfg.value
             , onInput cfg.onValue
             , attribute "aria-label" cfg.label
             , attribute "aria-valuetext" cfg.badge
             ]
                ++ (if String.isEmpty cfg.testid then
                        []

                    else
                        [ attribute "data-testid" cfg.testid ]
                   )
                ++ (if cfg.live then
                        [ on "pointerdown" (Decode.succeed StudioAdjustStart) ]

                    else
                        []
                   )
            )
            []
        ]


{-| Signed whole degrees (the hue badges). -}
signedDegrees : Float -> String
signedDegrees v =
    (if v > 0 then
        "+"

     else
        ""
    )
        ++ String.fromInt (round v)
        ++ "°"


{-| One decimal with the `:1` suffix (the seed contrast badge). -}
contrastBadge : Float -> String
contrastBadge v =
    let
        scaled =
            round (v * 10)

        whole =
            scaled // 10

        frac =
            modBy 10 (abs scaled)
    in
    String.fromInt whole ++ "." ++ String.fromInt frac ++ ":1"


{-| The generative palette engine (mirroring the `ts-factory` section). -}
factory : Model -> Html Msg
factory model =
    section [ class "ts-section ts-advanced", attribute "data-testid" "ts-advanced-editor", attribute "aria-labelledby" "ts-advanced-label" ]
        [ div [ class "ts-advanced__summary" ]
            [ span []
                [ strong [ id "ts-advanced-label" ] [ text "Advanced editor" ]
                , span [] [ text "Generate palettes, adjust tokens, and manage backgrounds" ]
                ]
            , span [ class "ts-advanced__toggle" ] [ text "Theme tools" ]
            ]
        , section [ class "ts-factory", attribute "aria-labelledby" "ts-factory-label", attribute "data-testid" "ts-factory" ]
            [ h2 [ class "ts-section__heading", id "ts-factory-label" ] [ text "Palette tools" ]
            , div [ class "ts-factory__grid" ]
                [ generateCol model
                , adjustCol model
                ]
            ]
        ]


{-| Seed → whole palette (mirroring the Generate column). -}
generateCol : Model -> Html Msg
generateCol model =
    let
        seed =
            model.studioSeed

        swatches =
            Studio.seedSwatches seed

        schemeBtn scheme label testid =
            button
                [ Html.Attributes.type_ "button"
                , class "ts-scheme-toggle__btn"
                , attribute "aria-pressed" (if seed.scheme == scheme then "true" else "false")
                , attribute "data-testid" testid
                , onClick (StudioSeedScheme { scheme = scheme })
                ]
                [ text label ]

        seedNum field inputId val sliderMin sliderMax sliderStep badge testid =
            rangeSlider
                { id = inputId
                , label = sliderLabel field
                , min = sliderMin
                , max = sliderMax
                , step = sliderStep
                , value = String.fromFloat val
                , badge = badge
                , testid = testid
                , onValue = \s -> StudioSeedNumber { field = field, value = String.toFloat s |> Maybe.withDefault val }
                , live = False
                }
    in
    div [ class "ts-factory__col", attribute "role" "group", attribute "aria-label" "Generate a palette from a seed" ]
        [ div [ class "ts-factory__col-head" ]
            [ span [ class "ts-eyebrow" ] [ text "// Generate" ]
            , div [ class "ts-scheme-toggle", attribute "role" "group", attribute "aria-label" "Colour scheme" ]
                [ schemeBtn "dark" "dark" "ts-scheme-dark"
                , schemeBtn "light" "light" "ts-scheme-light"
                ]
            ]
        , div [ class "ts-seed-colors" ]
            [ seedColor model "primary" "Primary seed" "ts-seed-primary" "Primary seed colour" swatches.primary seed.primaryHue
            , seedColor model "accent" "Accent seed" "ts-seed-accent" "Accent seed colour" swatches.accent seed.accentHue
            ]
        , div [ class "ts-factory__sliders" ]
            [ seedNum "primaryHue" "ts-gen-primary-hue" seed.primaryHue "0" "360" "1" (signedDegrees seed.primaryHue |> dropPlus) "ts-gen-primary-hue"
            , seedNum "accentHue" "ts-gen-accent-hue" seed.accentHue "0" "360" "1" (signedDegrees seed.accentHue |> dropPlus) "ts-gen-accent-hue"
            , seedNum "depth" "ts-gen-depth" seed.depth "0" "1" "0.01" (Studio.formatFixed2 seed.depth) "ts-gen-depth"
            , seedNum "vibrancy" "ts-gen-vibrancy" seed.vibrancy "0" "1" "0.01" (Studio.formatFixed2 seed.vibrancy) "ts-gen-vibrancy"
            , seedNum "warmth" "ts-gen-warmth" seed.warmth "-1" "1" "0.02" (Studio.fmtSigned seed.warmth) "ts-gen-warmth"
            , seedNum "contrast" "ts-gen-contrast" seed.contrast "4.5" "12" "0.1" (contrastBadge seed.contrast) "ts-gen-contrast"
            ]
        , div [ class "ts-factory__actions" ]
            [ btn "primary" "sm" [ attribute "data-testid" "ts-generate", onClick StudioGenerate ] [ text "[generate]" ]
            , btn "ghost" "sm" [ attribute "data-testid" "ts-randomize", onClick StudioRandomize ] [ text "[🎲 randomize]" ]
            , tip "top" (btn "ghost" "sm" [ attribute "data-testid" "ts-seed-from-current", onClick StudioSeedFromCurrent, title "Recover a seed from the palette that is live right now." ] [ text "[seed from current]" ])
            , div [ class "ts-seed-transfer", attribute "role" "group", attribute "aria-label" "Portable seed transfer" ]
                [ tip "top" (seedExportBtn model)
                , tip "top" (btn "ghost" "sm" [ class "ts-seed-btn", attribute "data-testid" "ts-import-seed", onClick StudioImportSeedRequest, title "Paste a portable seed JSON — validated fail-closed, then generated." ] [ text "[import seed]" ])
                ]
            ]
        , case model.studioSeedCopyFailure of
            Just failure ->
                p [ class "ts-error", attribute "role" "alert", attribute "data-testid" "ts-seed-copy-error" ] [ text failure ]

            Nothing ->
                text ""
        , p [ class "ts-factory__hint" ]
            [ text "One seed → a whole coherent palette, AA-clean by construction. After the first generate, the knobs re-generate live." ]
        ]


{-| The Generate hue badges never show a plus sign (the oracle formats
with a plain round). -}
dropPlus : String -> String
dropPlus s =
    if String.startsWith "+" s then
        String.dropLeft 1 s

    else
        s


sliderLabel : String -> String
sliderLabel field =
    case field of
        "primaryHue" ->
            "Primary hue"

        "accentHue" ->
            "Accent hue"

        "depth" ->
            "Depth"

        "vibrancy" ->
            "Vibrancy"

        "warmth" ->
            "Warmth"

        "contrast" ->
            "Contrast"

        _ ->
            field


{-| One seed colour well with its hex + hue readout (mirroring the
`ts-seed-color` blocks; the eye-dropper rides the accent well). -}
seedColor : Model -> String -> String -> String -> String -> String -> Float -> Html Msg
seedColor model field labelText inputId ariaLabel hex hue =
    div [ class "ts-seed-color" ]
        ([ label [ class "ts-token-label", for inputId ] [ text labelText ]
         , div [ class "ts-token-color-row" ]
            [ input
                [ Html.Attributes.type_ "color"
                , id inputId
                , class "ts-token-swatch"
                , value hex
                , onInput (\s -> StudioSeedColor { field = field, hex = s })
                , attribute "aria-label" ariaLabel
                , attribute "data-testid" inputId
                ]
                []
            , code [ class "ts-token-value" ] [ text (hex ++ " · " ++ String.fromInt (round hue) ++ "°") ]
            ]
         ]
            ++ (if field == "accent" then
                    [ eyeDropper model ]

                else
                    []
               )
        )


{-| Screen sampler on the accent well (mirroring the eye-dropper
button + status; the picker itself opens ports-side). -}
eyeDropper : Model -> Html Msg
eyeDropper model =
    span []
        ((if model.studioEyeDropperSupported then
            [ btn "ghost"
                "sm"
                [ class "ts-eyedropper-button"
                , disabled model.studioEyeDropperBusy
                , attribute "aria-busy" (if model.studioEyeDropperBusy then "true" else "false")
                , attribute "aria-label" "Sample accent seed colour from the screen"
                , attribute "data-testid" "ts-accent-eyedropper"
                , onClick StudioEyeDropperSample
                ]
                [ text
                    (if model.studioEyeDropperBusy then
                        "[sampling screen…]"

                     else
                        "[⌖ sample screen]"
                    )
                ]
            ]

           else
            []
         )
            ++ (case model.studioEyeDropperStatus of
                    Just status ->
                        [ span
                            [ class ("ts-eyedropper-status" ++ (if status.failure then " ts-eyedropper-status--error" else ""))
                            , attribute "role"
                                (if status.failure then
                                    "alert"

                                 else
                                    "status"
                                )
                            ]
                            [ text status.message ]
                        ]

                    Nothing ->
                        []
               )
        )


{-| Seed export button with its busy/copied states. -}
seedExportBtn : Model -> Html Msg
seedExportBtn model =
    btn "ghost"
        "sm"
        ([ class "ts-seed-btn"
         , disabled model.studioSeedBusy
         , attribute "aria-busy" (if model.studioSeedBusy then "true" else "false")
         , attribute "data-testid" "ts-export-seed"
         , onClick StudioExportSeed
         , title "Copy this seed as portable JSON — the recipient regenerates it AA-clean."
         ]
            ++ (if model.studioSeedCopied then
                    [ attribute "data-copied" "true" ]

                else
                    []
               )
        )
        [ text
            (if model.studioSeedBusy then
                "[copying seed…]"

             else if model.studioSeedCopied then
                "[✓ seed copied]"

             else
                "[export seed]"
            )
        ]


{-| Global transforms over the current palette (mirroring the Adjust
column; the baseline snapshot is taken fold-side on drag start). -}
adjustCol : Model -> Html Msg
adjustCol model =
    let
        adjust =
            model.studioAdjust

        dirty =
            adjustDirty model

        knob field inputId val sliderMin sliderMax sliderStep badge testid =
            rangeSlider
                { id = inputId
                , label = adjustLabel field
                , min = sliderMin
                , max = sliderMax
                , step = sliderStep
                , value = String.fromFloat val
                , badge = badge
                , testid = testid
                , onValue = \s -> StudioAdjustPatch { field = field, value = String.toFloat s |> Maybe.withDefault val }
                , live = True
                }
    in
    div [ class "ts-factory__col", attribute "role" "group", attribute "aria-label" "Adjust the current palette" ]
        [ div [ class "ts-factory__col-head" ]
            ([ span [ class "ts-eyebrow" ] [ text "// Adjust" ] ]
                ++ (if dirty then
                        [ span [ class "ts-badge ts-badge--modified" ] [ text "live" ] ]

                    else
                        []
                   )
            )
        , div [ class "ts-factory__sliders" ]
            [ knob "hueShift" "ts-adj-hue" adjust.hueShift "-180" "180" "1" (signedDegrees adjust.hueShift) "ts-adjust-hue"
            , knob "saturation" "ts-adj-sat" adjust.saturation "0" "1.6" "0.01" ("×" ++ Studio.formatFixed2 adjust.saturation) "ts-adjust-saturation"
            , knob "warmth" "ts-adj-warmth" adjust.warmth "-1" "1" "0.02" (Studio.fmtSigned adjust.warmth) "ts-adjust-warmth"
            , knob "contrast" "ts-adj-contrast" adjust.contrast "-1" "1" "0.02" (Studio.fmtSigned adjust.contrast) "ts-adjust-contrast"
            ]
        , div [ class "ts-factory__actions" ]
            [ tip "top" (btn "primary" "sm" [ attribute "data-testid" "ts-bake", disabled (not dirty), onClick StudioAdjustBake, title "Commit the adjusted palette and zero the knobs." ] [ text "[bake]" ])
            , tip "top" (btn "ghost" "sm" [ attribute "data-testid" "ts-adjust-revert", disabled (not dirty), onClick StudioAdjustRevert, title "Abandon the adjustment and restore the palette you started from." ] [ text "[revert]" ])
            ]
        , p [ class "ts-factory__hint" ]
            [ text "Relative nudges from the palette as it was when you started dragging — zero restores it exactly. Bake (or Save) keeps the result." ]
        ]


adjustLabel : String -> String
adjustLabel field =
    case field of
        "hueShift" ->
            "Hue rotate"

        "saturation" ->
            "Saturation"

        "warmth" ->
            "Warmth"

        "contrast" ->
            "Contrast"

        _ ->
            field


{-| Built-in + saved base themes (mirroring the Base theme grid). -}
baseSection : Model -> Html Msg
baseSection model =
    section [ class "ts-section", attribute "aria-labelledby" "ts-base-label" ]
        [ h2 [ class "ts-section__heading", id "ts-base-label" ] [ text "Base theme" ]
        , div [ class "ts-theme-grid", attribute "role" "radiogroup", attribute "aria-label" "Select base theme" ]
            (List.map (baseChip model) ThemeLook.themeMeta
                ++ List.map (customChip model) model.studioCustoms
            )
        ]


baseChip : Model -> ThemeLook.ThemeMeta -> Html Msg
baseChip model meta =
    let
        isOn =
            model.themeId == meta.id
    in
    button
        ([ Html.Attributes.type_ "button"
         , class "ts-theme-chip"
         , attribute "aria-pressed" (if isOn then "true" else "false")
         , attribute "data-testid" ("ts-theme-chip-" ++ meta.id)
         , onClick (AppearanceSetTheme { id = meta.id })
         ]
            ++ (if isOn then
                    [ attribute "data-active" "true" ]

                else
                    []
               )
        )
        [ span [ class "ts-theme-chip__label" ] [ text meta.label ]
        , span [ class "ts-theme-chip__scheme" ] [ text meta.scheme ]
        ]


customChip : Model -> Studio.CustomTheme -> Html Msg
customChip model custom =
    let
        isOn =
            model.themeId == custom.id
    in
    span [ class "ts-theme-chip-wrap" ]
        [ button
            ([ Html.Attributes.type_ "button"
             , class "ts-theme-chip ts-theme-chip--custom"
             , attribute "aria-pressed" (if isOn then "true" else "false")
             , attribute "data-testid" ("ts-theme-chip-" ++ custom.id)
             , onClick (AppearanceSetTheme { id = custom.id })
             ]
                ++ (if isOn then
                        [ attribute "data-active" "true" ]

                    else
                        []
                   )
            )
            [ span [ class "ts-theme-chip__label" ] [ text custom.name ]
            , span [ class "ts-theme-chip__scheme" ] [ text ("custom · " ++ custom.base) ]
            ]
        , button
            [ Html.Attributes.type_ "button"
            , class "ts-theme-chip-del"
            , attribute "aria-label" ("Delete theme " ++ custom.name)
            , title ("Delete " ++ custom.name)
            , onClick (StudioDeleteCustom { id = custom.id })
            ]
            [ text "×" ]
        ]


{-| Signature-scene background grid (mirroring the Background section;
staging itself lives on the page shelf — the studio commits at once). -}
backgroundSection : Model -> Html Msg
backgroundSection model =
    section [ class "ts-section", attribute "aria-labelledby" "ts-bg-label" ]
        [ h2 [ class "ts-section__heading", id "ts-bg-label" ] [ text "Background" ]
        , div [ class "ts-theme-grid", attribute "role" "radiogroup", attribute "aria-label" "Select background" ]
            (bgChip model "auto" "Auto" "match theme" "ts-bg-chip-auto"
                :: List.map
                    (\opt ->
                        bgChip model
                            opt.id
                            opt.label
                            (backgroundKindLabel opt.kind)
                            ("ts-bg-chip-" ++ opt.id)
                    )
                    ThemeLook.backgroundOptions
            )
        ]


backgroundKindLabel : ThemeLook.BackgroundKind -> String
backgroundKindLabel kind =
    case kind of
        ThemeLook.BackgroundAnimated ->
            "animated"

        ThemeLook.BackgroundSolid ->
            "solid"

        ThemeLook.BackgroundScene ->
            "scene"


bgChip : Model -> String -> String -> String -> String -> Html Msg
bgChip model id_ labelText scheme testid =
    let
        isOn =
            model.backgroundId == id_
    in
    button
        ([ Html.Attributes.type_ "button"
         , class "ts-theme-chip"
         , attribute "aria-pressed" (if isOn then "true" else "false")
         , attribute "data-testid" testid
         , onClick (StudioApplyBackground { id = id_ })
         ]
            ++ (if isOn then
                    [ attribute "data-active" "true" ]

                else
                    []
               )
        )
        [ span [ class "ts-theme-chip__label" ] [ text labelText ]
        , span [ class "ts-theme-chip__scheme" ] [ text scheme ]
        ]


{-| Tabbed token editor (mirroring the `ts-editor` + Tabs: the tablist
selects `studioTab`, only the active group's panel renders). -}
editor : Model -> Html Msg
editor model =
    let
        groups =
            Studio.studioGroups

        groupIds =
            List.map .id groups

        activeId =
            if List.member model.studioTab groupIds then
                model.studioTab

            else
                "surfaces"

        resolved =
            studioResolvedTokens model
    in
    div [ class "ts-editor", attribute "aria-label" "Advanced token editor" ]
        [ p [ class "ts-editor__intro" ] [ text "Fine tune individual colors and surfaces. Changes update the preview immediately." ]
        , div [ class "onyx-tabs" ]
            [ div [ class "onyx-tabs__list", attribute "role" "tablist", attribute "aria-label" "Token group" ]
                (List.map (groupTab activeId groupIds) groups)
            , case List.filter (\group -> group.id == activeId) groups |> List.head of
                Just group ->
                    div [ class "onyx-tabs__content", attribute "role" "tabpanel", tabindex 0 ]
                        [ groupPanel model resolved group ]

                Nothing ->
                    text ""
            ]
        ]


groupTab : String -> List String -> Studio.StudioGroup -> Html Msg
groupTab activeId ids group =
    let
        isOn =
            group.id == activeId
    in
    button
        [ Html.Attributes.type_ "button"
        , class "onyx-tabs__trigger"
        , attribute "role" "tab"
        , attribute "aria-selected" (if isOn then "true" else "false")
        , tabindex (if isOn then 0 else -1)
        , on "keydown" (tabKey ids group.id)
        , onClick (StudioTabSelect { id = group.id })
        ]
        [ text group.label ]


{-| One group's token controls (mirroring `GroupPanel`). -}
groupPanel : Model -> Dict String String -> Studio.StudioGroup -> Html Msg
groupPanel model resolved group =
    div [ class "ts-group", attribute "data-testid" ("ts-group-" ++ group.id) ]
        (List.map (tokenControl model resolved) group.tokens)


{-| One token control (mirroring `TokenControl`: colour well, radius /
duration sliders, text fields, and the per-token revert). -}
tokenControl : Model -> Dict String String -> Studio.StudioToken -> Html Msg
tokenControl model resolved token =
    let
        raw =
            Dict.get token.property resolved |> Maybe.withDefault ""

        modified =
            Dict.member token.property model.studioOverrides

        controlId =
            "ts-control-" ++ (token.property |> dropVarPrefix |> String.replace "-" "_")

        revertTestid =
            "ts-revert-" ++ dropVarPrefix token.property

        revert =
            if modified then
                [ button
                    [ Html.Attributes.type_ "button"
                    , class "ts-token-revert"
                    , onClick (StudioTokenReset { property = token.property })
                    , attribute "aria-label" ("Revert " ++ token.label ++ " to base")
                    , title "Revert to base value"
                    , attribute "data-testid" revertTestid
                    ]
                    [ text "↺ revert" ]
                ]

            else
                []
    in
    div [ class "ts-token-control" ]
        ([ tokenInput token controlId raw ] ++ revert)


dropVarPrefix : String -> String
dropVarPrefix property =
    if String.startsWith "--" property then
        String.dropLeft 2 property

    else
        property


tokenInput : Studio.StudioToken -> String -> String -> Html Msg
tokenInput token controlId raw =
    case token.tokenType of
        Studio.TokenColor ->
            div []
                [ label [ class "ts-token-label", for controlId ] [ text token.label ]
                , div [ class "ts-token-color-row" ]
                    [ input
                        [ Html.Attributes.type_ "color"
                        , id controlId
                        , class "ts-token-swatch"
                        , value
                            (if String.startsWith "#" raw then
                                raw

                             else
                                "#000000"
                            )
                        , onInput (\s -> StudioTokenInput { property = token.property, value = s })
                        , attribute "aria-label" token.label
                        ]
                        []
                    , code [ class "ts-token-value" ] [ text raw ]
                    ]
                ]

        Studio.TokenRadius ->
            rangeSlider
                { id = controlId
                , label = token.label
                , min = token.min |> Maybe.map String.fromFloat |> Maybe.withDefault "0"
                , max = token.max |> Maybe.map String.fromFloat |> Maybe.withDefault "24"
                , step = token.step |> Maybe.map String.fromFloat |> Maybe.withDefault "1"
                , value = String.fromFloat (parseSuffixed "px" raw 0)
                , badge = raw
                , testid = ""
                , onValue = \s -> StudioTokenInput { property = token.property, value = s ++ "px" }
                , live = False
                }

        Studio.TokenDuration ->
            rangeSlider
                { id = controlId
                , label = token.label
                , min = token.min |> Maybe.map String.fromFloat |> Maybe.withDefault "0"
                , max = token.max |> Maybe.map String.fromFloat |> Maybe.withDefault "600"
                , step = token.step |> Maybe.map String.fromFloat |> Maybe.withDefault "20"
                , value = String.fromFloat (parseSuffixed "ms" raw 0)
                , badge = raw
                , testid = ""
                , onValue = \s -> StudioTokenInput { property = token.property, value = s ++ "ms" }
                , live = False
                }

        Studio.TokenFont ->
            tokenText token controlId raw

        Studio.TokenEasing ->
            tokenText token controlId raw


{-| Text-backed token field (mirroring the `FormField` use). -}
tokenText : Studio.StudioToken -> String -> String -> Html Msg
tokenText token controlId raw =
    div [ class "onyx-field ts-token-text-field" ]
        [ label [ class "onyx-field__label", for controlId ] [ text token.label ]
        , input
            [ id controlId
            , class "onyx-field__input"
            , value raw
            , onInput (\s -> StudioTokenInput { property = token.property, value = s })
            , attribute "aria-label" token.label
            , attribute "spellcheck" "false"
            ]
            []
        ]


{-| Strip a unit suffix and read the number (the radius / duration
slider values). -}
parseSuffixed : String -> String -> Float -> Float
parseSuffixed suffix raw fallback =
    if String.endsWith suffix raw then
        String.dropRight (String.length suffix) raw
            |> String.toFloat
            |> Maybe.withDefault fallback

    else
        fallback


{-| The static mock client (mirroring `StudioPreview`: channel rail,
thread, actions, composer, member list — every surface paints from the
live CSS vars so the mock re-tints with the palette). -}
preview : Html Msg
preview =
    div [ class "ts-preview", attribute "aria-label" "Live preview" ]
        [ div [ class "ts-preview__bar" ]
            [ span [ class "ts-preview__bar-dot", style "background" "var(--shu)" ] []
            , span [ class "ts-preview__bar-dot", style "background" "var(--gold)" ] []
            , span [ class "ts-preview__bar-dot", style "background" "var(--ok)" ] []
            , span [ class "ts-preview__bar-title" ] [ text "onyx — eshmaki.me" ]
            ]
        , div [ class "ts-preview__chrome", attribute "aria-hidden" "true" ]
            [ div [ class "ts-pv-side" ]
                [ div [ class "ts-pv-side__server" ]
                    [ span [ class "ts-pv-side__sigil" ] [ text "◆" ], text "onyx" ]
                , div [ class "ts-pv-side__group" ] [ text "rooms" ]
                , div [ class "ts-pv-chan", attribute "data-active" "true" ]
                    [ span [ class "ts-pv-chan__hash" ] [ text "#" ], text "general" ]
                , div [ class "ts-pv-chan" ]
                    [ span [ class "ts-pv-chan__hash" ] [ text "#" ]
                    , text "reef"
                    , span [ class "ts-pv-chan__pip" ] []
                    ]
                , div [ class "ts-pv-chan" ]
                    [ span [ class "ts-pv-chan__hash" ] [ text "#" ]
                    , text "dev"
                    , span [ class "ts-pv-chan__count" ] [ text "3" ]
                    ]
                , div [ class "ts-pv-chan ts-pv-chan--muted" ]
                    [ span [ class "ts-pv-chan__hash" ] [ text "#" ], text "abyss" ]
                , div [ class "ts-pv-side__group" ] [ text "calls" ]
                , div [ class "ts-pv-chan" ]
                    [ span [ class "ts-pv-chan__hash ts-pv-chan__hash--voice" ] [ text "◉" ]
                    , text "tide-pool"
                    ]
                ]
            , div [ class "ts-pv-main" ]
                [ div [ class "ts-pv-head" ]
                    [ span [ class "ts-pv-head__chan" ] [ text "#general" ]
                    , span [ class "ts-pv-head__topic" ] [ text "the tide is calm tonight" ]
                    , span [ class "ts-pv-badge ts-pv-badge--accent" ] [ text "beta" ]
                    , span [ class "ts-pv-badge ts-pv-badge--hot" ] [ text "3 new" ]
                    ]
                , div [ class "ts-pv-thread" ]
                    [ pvMsg "21:04" "var(--lapis-bright)" "aoi" "surfaced from the deep current" False
                    , div [ class "ts-pv-msg" ]
                        [ span [ class "ts-pv-msg__time" ] [ text "21:06" ]
                        , span [ class "ts-pv-msg__nick", style "color" "var(--gold-bright)" ] [ text "kain" ]
                        , span [ class "ts-pv-msg__text" ]
                            [ text "pushing the reef build tonight — "
                            , span [ class "ts-pv-msg__link" ] [ text "eshmaki.me/stats" ]
                            ]
                        ]
                    , pvMsg "21:07" "var(--ok)" "onyx" "→ network: 2 homes linked, quorum ok" True
                    , pvMsg "21:09" "var(--shu)" "rei" "a coral light drifting through dark water" False
                    ]
                , div [ class "ts-pv-actions" ]
                    [ button [ Html.Attributes.type_ "button", class "ts-pv-btn ts-pv-btn--primary", tabindex -1 ] [ text "join call" ]
                    , button [ Html.Attributes.type_ "button", class "ts-pv-btn ts-pv-btn--danger", tabindex -1 ] [ text "leave" ]
                    ]
                , div [ class "ts-pv-composer" ]
                    [ span [ class "ts-pv-composer__prompt" ] [ text "›" ]
                    , span [ class "ts-pv-composer__ghost" ] [ text "message #general" ]
                    , span [ class "ts-pv-composer__cursor" ] [ text "█" ]
                    , button [ Html.Attributes.type_ "button", class "ts-pv-btn ts-pv-btn--primary ts-pv-btn--send", tabindex -1 ] [ text "send" ]
                    ]
                ]
            , div [ class "ts-pv-members" ]
                [ div [ class "ts-pv-members__head" ] [ text "people — 4" ]
                , pvMember "var(--gold-bright)" "!" "aoi" "var(--ok)" False
                , pvMember "var(--lapis-bright)" "@" "kain" "var(--ok)" False
                , pvMember "var(--ok)" "+" "rei" "var(--warn)" False
                , pvMember "" " " "mira" "var(--paper-mute)" True
                ]
            ]
        ]


pvMsg : String -> String -> String -> String -> Bool -> Html Msg
pvMsg time nickColor nick body dim =
    div [ class "ts-pv-msg" ]
        [ span [ class "ts-pv-msg__time" ] [ text time ]
        , span [ class "ts-pv-msg__nick", style "color" nickColor ] [ text nick ]
        , span [ class ("ts-pv-msg__text" ++ (if dim then " ts-pv-msg__text--dim" else "")) ] [ text body ]
        ]


pvMember : String -> String -> String -> String -> Bool -> Html Msg
pvMember sigilColor sigil nick dot plain =
    div [ class ("ts-pv-member" ++ (if plain then " ts-pv-member--plain" else "")) ]
        [ span [ class "ts-pv-member__sigil", style "color" sigilColor ] [ text sigil ]
        , text nick
        , span [ class "ts-pv-member__dot", style "background" dot ] []
        ]


{-| Live contrast grades over the resolved palette (mirroring
`ContrastAudit`). -}
audit : Model -> Html Msg
audit model =
    let
        resolved =
            studioResolvedTokens model

        rows =
            Studio.auditContrast resolved

        failing =
            Studio.auditFailing resolved rows
    in
    div [ class "ts-audit", attribute "aria-label" "Contrast audit", attribute "data-testid" "ts-contrast-audit" ]
        [ div [ class "ts-audit__head" ]
            [ span [ class "ts-eyebrow" ] [ text "// Contrast (WCAG AA)" ]
            , if failing > 0 then
                span [ class "ts-audit__status ts-audit__status--warn", attribute "data-testid" "ts-audit-status" ]
                    [ text (String.fromInt failing ++ " below AA") ]

              else
                span [ class "ts-audit__status ts-audit__status--ok", attribute "data-testid" "ts-audit-status" ]
                    [ text "all pass AA" ]
            ]
        , ul [ class "ts-audit__list" ]
            (List.map auditRow rows)
        , button
            ([ Html.Attributes.type_ "button"
             , class "ts-audit__fix"
             , onClick StudioAutoFix
             , attribute "data-testid" "ts-autofix"
             , title "Nudge text tokens until every pair clears its WCAG floor."
             ]
                ++ (if failing > 0 then
                        [ attribute "data-failing" "true" ]

                    else
                        []
                   )
            )
            [ text "⚑ auto-fix to AA" ]
        ]


auditRow : Studio.AuditRow -> Html Msg
auditRow row =
    li [ class "ts-audit__row" ]
        ([ span
            [ class "ts-audit__sample"
            , attribute "aria-hidden" "true"
            , style "background" ("var(" ++ row.bg ++ ")")
            , style "color" ("var(" ++ row.fg ++ ")")
            ]
            [ text "Aa" ]
         , span [ class "ts-audit__label" ] [ text row.label ]
         ]
            ++ (case ( row.ratio, row.level ) of
                    ( Just ratio, Just level ) ->
                        [ span [ class "ts-audit__ratio", title (String.fromFloat ratio ++ ":1") ]
                            [ text (Studio.formatFixed2 ratio) ]
                        , span
                            [ class ("ts-audit__badge ts-audit__badge--" ++ Studio.auditBadgeClass level)
                            , attribute "aria-label" (row.label ++ ": contrast " ++ String.fromFloat ratio ++ " to one, " ++ level)
                            ]
                            [ text level ]
                        ]

                    _ ->
                        [ span [ class "ts-audit__badge ts-audit__badge--na" ] [ text "n/a" ] ]
               )
        )


{-| Reset / save / import / export / share (mirroring the `ts-footer`). -}
studioFooter : Model -> Html Msg
studioFooter model =
    footer [ class "ts-footer" ]
        [ div [ class "ts-footer__left" ]
            ([ tip "top"
                (btn "ghost"
                    "sm"
                    [ attribute "data-testid" "ts-reset-btn"
                    , disabled (not (hasOverrides model) && not (factoryDirty model))
                    , onClick StudioReset
                    , title "Reset all custom overrides to the base theme defaults."
                    ]
                    [ text "[reset]" ]
                )
             ]
                ++ saveBlock model
            )
        , div [ class "ts-footer__right" ]
            ([ case model.studioImportError of
                Just err ->
                    span [ class "ts-error", attribute "role" "alert", attribute "data-testid" "ts-import-error" ] [ text err ]

                Nothing ->
                    text ""
             , case model.studioCopyFailure of
                Just failure ->
                    span [ class "ts-error", attribute "role" "alert", attribute "data-testid" "ts-copy-error" ] [ text failure ]

                Nothing ->
                    text ""
             ]
                ++ (case shareableCustom model of
                        Just _ ->
                            [ tip "top" (shareBtn model) ]

                        Nothing ->
                            []
                   )
                ++ [ tip "top" (btn "ghost" "sm" [ attribute "data-testid" "ts-import-btn", onClick StudioImportRequest, title "Import a previously exported theme JSON blob." ] [ text "[import]" ])
                   , tip "top" (exportBtn model)
                   ]
            )
        ]


{-| Save button or the inline name row (mirroring `saving()`). -}
saveBlock : Model -> List (Html Msg)
saveBlock model =
    if model.studioSaving then
        [ div [ class "ts-save-row", attribute "role" "group", attribute "aria-label" "Name your theme" ]
            [ input
                [ class "ts-save-input"
                , value model.studioSaveName
                , placeholder "Theme name"
                , attribute "aria-label" "Theme name"
                , attribute "spellcheck" "false"
                , onInput (\s -> StudioSaveNameInput { name = s })
                , on "keydown" saveKey
                ]
                []
            , btn "primary" "sm" [ attribute "data-testid" "ts-save-confirm", onClick StudioConfirmSave ] [ text "save" ]
            , btn "ghost" "sm" [ onClick StudioCancelSave ] [ text "cancel" ]
            ]
        ]

    else
        [ tip "top" (btn "primary" "sm" [ attribute "data-testid" "ts-save-btn", onClick StudioBeginSave, title "Save the current base + edits as a named theme you can select anywhere." ] [ text "[save theme]" ]) ]


{-| Share-link button with its busy/copied states. -}
shareBtn : Model -> Html Msg
shareBtn model =
    btn "ghost"
        "sm"
        [ disabled model.studioShareBusy
        , attribute "aria-busy" (if model.studioShareBusy then "true" else "false")
        , onClick StudioShare
        , attribute "data-testid" "ts-share-btn"
        , title
            (if model.studioShareCopied then
                "Link copied to clipboard!"

             else
                "Copy a shareable link to this custom theme."
            )
        ]
        [ text
            (if model.studioShareBusy then
                "[copying link…]"

             else if model.studioShareCopied then
                "[copied!]"

             else
                "[share link]"
            )
        ]


{-| Theme-JSON export button with its busy/copied states. -}
exportBtn : Model -> Html Msg
exportBtn model =
    btn "ghost"
        "sm"
        [ disabled model.studioExportBusy
        , attribute "aria-busy" (if model.studioExportBusy then "true" else "false")
        , onClick StudioExport
        , attribute "data-testid" "ts-export-btn"
        , title
            (if model.studioExportCopied then
                "Copied to clipboard!"

             else
                "Export current token overrides as JSON."
            )
        ]
        [ text
            (if model.studioExportBusy then
                "[copying…]"

             else if model.studioExportCopied then
                "[copied!]"

             else
                "[export]"
            )
        ]
