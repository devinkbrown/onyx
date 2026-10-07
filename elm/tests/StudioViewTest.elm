module StudioViewTest exposing (suite)

{-| Render/event vectors for `View.Studio`, mirroring
`src/theme/ThemeStudio.tsx` chrome and hooks: header badge, factory
knobs, base/background grids, tabbed editor, preview, audit, and the
footer. Rendering + message wiring only — fold semantics stay in
`StudioFoldTest`.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Route
import Studio
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import ThemeLook
import View
import View.Studio


query : Model -> Query.Single Msg
query model =
    View.Studio.studio model
        |> Query.fromHtml


overridden : Model
overridden =
    Tuple.first (update (StudioTokenInput { property = "--ink", value = "#123456" }) blank)


adjusted : Model
adjusted =
    Tuple.first (update (StudioAdjustPatch { field = "hueShift", value = 10 }) blank)


customModel : Model
customModel =
    { blank
        | themeId = "custom:test"
        , studioCustoms =
            [ { id = "custom:test"
              , name = "Test look"
              , base = "ocean"
              , overrides = Dict.empty
              }
            ]
    }


firstBackground : String
firstBackground =
    ThemeLook.backgroundOptions
        |> List.head
        |> Maybe.map .id
        |> Maybe.withDefault "missing"


suite : Test
suite =
    describe "Studio view"
        [ test "studio root renders with the eyebrow and no badge when clean" <|
            \_ ->
                Expect.all
                    [ \q -> q |> Query.has [ Selector.attribute (Attr.attribute "data-testid" "theme-studio") ]
                    , \q -> q |> Query.has [ Selector.text "// Theme Studio" ]
                    , \q -> q |> Query.hasNot [ Selector.text "modified" ]
                    , \q -> q |> Query.hasNot [ Selector.class "ts-badge--modified" ]
                    ]
                    (query blank)
        , test "header description follows the active built-in look" <|
            \_ ->
                query blank
                    |> Query.has [ Selector.text "The flagship — mineral night, quiet cyan signal, and matte, focused surfaces." ]
        , test "session overrides raise the modified badge" <|
            \_ ->
                query overridden
                    |> Query.has [ Selector.text "modified" ]
        , test "custom theme header names its base look" <|
            \_ ->
                query customModel
                    |> Query.has [ Selector.text "Your custom theme, based on Ocean." ]
        , test "generate button fires the generate fold" <|
            \_ ->
                query blank
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-generate") ]
                    |> Event.simulate Event.click
                    |> Event.expect StudioGenerate
        , test "scheme toggle fires the seed scheme fold" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-scheme-light") ]
                            |> Event.simulate Event.click
                            |> Event.expect (StudioSeedScheme { scheme = "light" })
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-scheme-dark") ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-pressed" "true") ]
                    ]
                    (query blank)
        , test "seed hue slider input fires the seed number fold" <|
            \_ ->
                query blank
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-gen-primary-hue") ]
                    |> Event.simulate (Event.input "200")
                    |> Event.expect (StudioSeedNumber { field = "primaryHue", value = 200 })
        , test "seed colour well input fires the seed colour fold" <|
            \_ ->
                query blank
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-seed-primary") ]
                    |> Event.simulate (Event.input "#ff0000")
                    |> Event.expect (StudioSeedColor { field = "primary", hex = "#ff0000" })
        , test "randomize and seed-from-current fire their folds" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-randomize") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioRandomize
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-seed-from-current") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioSeedFromCurrent
                    ]
                    (query blank)
        , test "seed transfer buttons fire export and import folds" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-export-seed") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioExportSeed
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-import-seed") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioImportSeedRequest
                    ]
                    (query blank)
        , test "adjust slider input fires the adjust patch fold" <|
            \_ ->
                query blank
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-adjust-hue") ]
                    |> Event.simulate (Event.input "10")
                    |> Event.expect (StudioAdjustPatch { field = "hueShift", value = 10 })
        , test "dirty adjust raises the live badge and arms bake" <|
            \_ ->
                Expect.all
                    [ \q -> q |> Query.has [ Selector.text "live" ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-bake") ]
                            |> Query.has [ Selector.disabled False ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-bake") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioAdjustBake
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-adjust-revert") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioAdjustRevert
                    ]
                    (query adjusted)
        , test "bake stays disabled while the knobs are at identity" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-bake") ]
                            |> Query.has [ Selector.disabled True ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-reset-btn") ]
                            |> Query.has [ Selector.disabled True ]
                    ]
                    (query blank)
        , test "base grid lists every built-in look and marks the active one" <|
            \_ ->
                Expect.all
                    ((\q ->
                        q
                            |> Query.find
                                [ Selector.attribute (Attr.attribute "data-testid" "ts-theme-chip-ocean") ]
                            |> Query.has [ Selector.attribute (Attr.attribute "data-active" "true") ]
                     )
                        :: List.map
                            (\meta ->
                                \q ->
                                    q
                                        |> Query.has
                                            [ Selector.attribute
                                                (Attr.attribute "data-testid" ("ts-theme-chip-" ++ meta.id))
                                            ]
                            )
                            ThemeLook.themeMeta
                    )
                    (query blank)
        , test "base chip click switches the look" <|
            \_ ->
                query blank
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-theme-chip-tide") ]
                    |> Event.simulate Event.click
                    |> Event.expect (AppearanceSetTheme { id = "tide" })
        , test "saved custom theme renders a deletable chip" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-theme-chip-custom:test") ]
                            |> Query.has [ Selector.text "Test look" ]
                    , \q ->
                        q
                            |> Query.find
                                [ Selector.tag "button"
                                , Selector.containing [ Selector.text "Test look" ]
                                ]
                            |> Event.simulate Event.click
                            |> Event.expect (AppearanceSetTheme { id = "custom:test" })
                    ]
                    (query customModel)
        , test "background grid fires the studio background fold" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-bg-chip-auto") ]
                            |> Query.has [ Selector.attribute (Attr.attribute "data-active" "true") ]
                    , \q ->
                        q
                            |> Query.find
                                [ Selector.attribute (Attr.attribute "data-testid" ("ts-bg-chip-" ++ firstBackground)) ]
                            |> Event.simulate Event.click
                            |> Event.expect (StudioApplyBackground { id = firstBackground })
                    ]
                    (query blank)
        , test "editor lists every token group tab with the first active" <|
            \_ ->
                Expect.all
                    ((\q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-group-surfaces") ]
                            |> Query.has [ Selector.attribute (Attr.attribute "id" "ts-control-ink") ]
                     )
                        :: List.map
                            (\group ->
                                \q ->
                                    q
                                        |> Query.has [ Selector.text group.label ]
                            )
                            Studio.studioGroups
                    )
                    (query blank)
        , test "tab click selects the token group" <|
            \_ ->
                query blank
                    |> Query.find
                        [ Selector.class "onyx-tabs__trigger"
                        , Selector.containing [ Selector.text "Accents" ]
                        ]
                    |> Event.simulate Event.click
                    |> Event.expect (StudioTabSelect { id = "accents" })
        , test "token colour input fires the token fold" <|
            \_ ->
                query blank
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-group-surfaces") ]
                    |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Ink (base ground)") ]
                    |> Event.simulate (Event.input "#123456")
                    |> Event.expect (StudioTokenInput { property = "--ink", value = "#123456" })
        , test "overridden token gains a revert control" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.has [ Selector.attribute (Attr.attribute "data-testid" "ts-revert-ink") ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-revert-ink") ]
                            |> Event.simulate Event.click
                            |> Event.expect (StudioTokenReset { property = "--ink" })
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-reset-btn") ]
                            |> Query.has [ Selector.disabled False ]
                    ]
                    (query overridden)
        , test "preview mock renders the channel thread" <|
            \_ ->
                Expect.all
                    [ \q -> q |> Query.has [ Selector.text "the tide is calm tonight" ]
                    , \q -> q |> Query.has [ Selector.text "people — 4" ]
                    , \q -> q |> Query.has [ Selector.text "message #general" ]
                    ]
                    (query blank)
        , test "audit grades every contrast pair" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-contrast-audit") ]
                            |> Query.findAll [ Selector.class "ts-audit__row" ]
                            |> Query.count (Expect.equal (List.length Studio.contrastPairs))
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-audit-status") ]
                            |> Query.has [ Selector.text "all pass AA" ]
                    ]
                    (query blank)
        , test "unreadable pair fails the audit and flags auto-fix" <|
            \_ ->
                let
                    broken =
                        Tuple.first
                            (update (StudioTokenInput { property = "--paper", value = "#000000" }) blank)
                in
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-audit-status") ]
                            |> Query.has [ Selector.containing [ Selector.text "below AA" ] ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-autofix") ]
                            |> Query.has [ Selector.attribute (Attr.attribute "data-failing" "true") ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-autofix") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioAutoFix
                    ]
                    (query broken)
        , test "footer reset, import, and export fire their folds" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-reset-btn") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioReset
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-import-btn") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioImportRequest
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-export-btn") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioExport
                    ]
                    (query overridden)
        , test "export busy and copied states relabel the button" <|
            \_ ->
                Expect.all
                    [ \q -> q |> Query.has [ Selector.text "[copying…]" ]
                    ]
                    (query { blank | studioExportBusy = True })
        , test "save opens the inline name row with keyboard commit" <|
            \_ ->
                let
                    saving =
                        Tuple.first (update StudioBeginSave blank)

                    q =
                        query saving
                in
                Expect.all
                    [ \_ ->
                        q
                            |> Query.find [ Selector.class "ts-save-input" ]
                            |> Event.simulate (Event.input "Harbor dusk")
                            |> Event.expect (StudioSaveNameInput { name = "Harbor dusk" })
                    , \_ ->
                        q
                            |> Query.find [ Selector.class "ts-save-input" ]
                            |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "Enter" ) ]))
                            |> Event.expect StudioConfirmSave
                    , \_ ->
                        q
                            |> Query.find [ Selector.class "ts-save-input" ]
                            |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "Escape" ) ]))
                            |> Event.expect StudioCancelSave
                    , \_ ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-save-confirm") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioConfirmSave
                    ]
                    ()
        , test "save button opens the flow when idle" <|
            \_ ->
                query blank
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-save-btn") ]
                    |> Event.simulate Event.click
                    |> Event.expect StudioBeginSave
        , test "share appears only for a saved custom theme" <|
            \_ ->
                Expect.all
                    [ \q -> q |> Query.hasNot [ Selector.attribute (Attr.attribute "data-testid" "ts-share-btn") ]
                    ]
                    (query blank)
        , test "share button fires the share fold on a custom theme" <|
            \_ ->
                query customModel
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-share-btn") ]
                    |> Event.simulate Event.click
                    |> Event.expect StudioShare
        , test "import, copy, and seed errors render as alerts" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-import-error") ]
                            |> Query.has [ Selector.text "bad blob" ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-copy-error") ]
                            |> Query.has [ Selector.text "no clipboard" ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-seed-copy-error") ]
                            |> Query.has [ Selector.text "no seed clipboard" ]
                    ]
                    (query
                        { blank
                            | studioImportError = Just "bad blob"
                            , studioCopyFailure = Just "no clipboard"
                            , studioSeedCopyFailure = Just "no seed clipboard"
                        }
                    )
        , test "eye-dropper hides without platform support" <|
            \_ ->
                query blank
                    |> Query.hasNot [ Selector.attribute (Attr.attribute "data-testid" "ts-accent-eyedropper") ]
        , test "eye-dropper samples and reports status when supported" <|
            \_ ->
                Expect.all
                    [ \q ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ts-accent-eyedropper") ]
                            |> Event.simulate Event.click
                            |> Event.expect StudioEyeDropperSample
                    , \q ->
                        q
                            |> Query.has [ Selector.text "[⌖ sample screen]" ]
                    ]
                    (query { blank | studioEyeDropperSupported = True })
        , test "eye-dropper failure status renders as an alert" <|
            \_ ->
                query
                    { blank
                        | studioEyeDropperSupported = True
                        , studioEyeDropperStatus = Just { message = "denied", failure = True }
                    }
                    |> Query.has [ Selector.text "denied" ]
        , test "appearance route embeds the studio in the advanced shelf" <|
            \_ ->
                View.view { blank | route = Route.Appearance }
                    |> .body
                    |> Html.div []
                    |> Query.fromHtml
                    |> Query.has [ Selector.attribute (Attr.attribute "data-testid" "theme-studio") ]
        ]
