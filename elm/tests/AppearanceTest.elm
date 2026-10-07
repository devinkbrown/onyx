module AppearanceTest exposing (suite)

{-| Appearance fold vectors, mirroring `src/app/Appearance.tsx` +
`src/lib/prefs/preferences.ts` + `src/theme/*` + `src/shell/themeBackground.ts`:
five-slot snapshot seeding, typed preference sets, look application,
background stage/preview/apply/cancel, and radio-key travel.
-}

import App exposing (..)
import Expect
import Json.Encode as Encode
import Prefs
import Route
import Test exposing (Test, describe, test)
import ThemeLook


snapshotOf : String -> String -> String -> String -> Encode.Value
snapshotOf prefsJson motion themeId backgroundId =
    Encode.object
        [ ( "prefsJson", Encode.string prefsJson )
        , ( "legacyContrast", Encode.string "" )
        , ( "sceneMotion", Encode.string motion )
        , ( "themeId", Encode.string themeId )
        , ( "backgroundId", Encode.string backgroundId )
        , ( "customThemesJson", Encode.string "[]" )
        ]


isApply : Outbound -> Bool
isApply outbound =
    case outbound of
        AppearanceApply _ ->
            True

        _ ->
            False


seeded : Model
seeded =
    Tuple.first
        (update
            (AppearanceSnapshot
                (snapshotOf (Prefs.encodePreferences Prefs.defaultPreferences) "off" "tide" "ember")
            )
            blank
        )


suite : Test
suite =
    describe "Appearance"
        [ test "snapshot seeds all five slots and applies once" <|
            \_ ->
                let
                    ( next, outbounds ) =
                        update
                            (AppearanceSnapshot
                                (snapshotOf (Prefs.encodePreferences Prefs.defaultPreferences) "off" "tide" "ember")
                            )
                            blank
                in
                Expect.all
                    [ \( m, _ ) -> Expect.equal True m.prefsReady
                    , \( m, _ ) -> Expect.equal Prefs.defaultPreferences m.prefs
                    , \( m, _ ) -> Expect.equal Prefs.SceneOff m.sceneMotion
                    , \( m, _ ) -> Expect.equal "tide" m.themeId
                    , \( m, _ ) -> Expect.equal "ember" m.backgroundId
                    , \( m, _ ) -> Expect.equal "ember" m.backgroundCandidate
                    , \( m, _ ) -> Expect.equal Nothing m.backgroundPreview
                    , \( _, out ) ->
                        Expect.all
                            [ \o -> Expect.equal 1 (List.length o)
                            , \o -> Expect.equal True (List.all isApply o)
                            ]
                            out
                    ]
                    ( next, outbounds )
        , test "snapshot with unknown theme falls back to the default look" <|
            \_ ->
                Expect.equal ThemeLook.defaultThemeId
                    (Tuple.first
                        (update
                            (AppearanceSnapshot
                                (snapshotOf (Prefs.encodePreferences Prefs.defaultPreferences) "" "nope" "")
                            )
                            blank
                        )
                    ).themeId
        , test "unknown look ids never apply" <|
            \_ ->
                let
                    ( next, outbounds ) =
                        update (AppearanceSetTheme { id = "nope" }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal "tide" next.themeId
                    , \_ -> Expect.equal [] outbounds
                    ]
                    ()
        , test "setting the current look is a silent no-op" <|
            \_ ->
                Expect.equal ( seeded, [] )
                    (update (AppearanceSetTheme { id = "tide" }) seeded)
        , test "applying a look stores it and re-applies the DOM" <|
            \_ ->
                let
                    ( next, outbounds ) =
                        update (AppearanceSetTheme { id = "abyss" }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal "abyss" next.themeId
                    , \_ ->
                        Expect.all
                            [ \o -> Expect.equal [ AppearanceStoreTheme { id = "abyss" } ] (List.take 1 o)
                            , \o -> Expect.equal True (List.all isApply (List.drop 1 o) && List.length o == 2)
                            ]
                            outbounds
                    ]
                    ()
        , test "text-size preference stores and re-applies" <|
            \_ ->
                let
                    ( next, outbounds ) =
                        update (AppearanceSetPref { key = "fontScale", value = "lg" }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal Prefs.FontLarge next.prefs.fontScale
                    , \_ ->
                        Expect.all
                            [ \o -> Expect.equal [ AppearanceStorePrefs { json = Prefs.encodePreferences next.prefs } ] (List.take 1 o)
                            , \o -> Expect.equal True (List.all isApply (List.drop 1 o) && List.length o == 2)
                            ]
                            outbounds
                    ]
                    ()
        , test "unknown preference keys keep the current value silently" <|
            \_ ->
                Expect.equal ( seeded, [] )
                    (update (AppearanceSetPref { key = "nope", value = "large" }) seeded)
        , test "invalid preference values keep the current value silently" <|
            \_ ->
                Expect.equal ( seeded, [] )
                    (update (AppearanceSetPref { key = "fontScale", value = "huge" }) seeded)
        , test "reduce-motion toggle flips and stores" <|
            \_ ->
                let
                    ( next, outbounds ) =
                        update AppearanceToggleReduceMotion seeded
                in
                Expect.all
                    [ \_ -> Expect.equal True next.prefs.reduceMotion
                    , \_ ->
                        Expect.all
                            [ \o -> Expect.equal [ AppearanceStorePrefs { json = Prefs.encodePreferences next.prefs } ] (List.take 1 o)
                            , \o -> Expect.equal True (List.all isApply (List.drop 1 o) && List.length o == 2)
                            ]
                            outbounds
                    ]
                    ()
        , test "data-saver toggle flips between off and adaptive" <|
            \_ ->
                let
                    ( off, offOut ) =
                        update AppearanceToggleSceneMotion seeded

                    ( back, backOut ) =
                        update AppearanceToggleSceneMotion off
                in
                Expect.all
                    [ \_ -> Expect.equal Prefs.SceneAdaptive off.sceneMotion
                    , \_ ->
                        Expect.all
                            [ \o -> Expect.equal [ AppearanceStoreSceneMotion { value = "adaptive" } ] (List.take 1 o)
                            , \o -> Expect.equal True (List.all isApply (List.drop 1 o) && List.length o == 2)
                            ]
                            offOut
                    , \_ -> Expect.equal Prefs.SceneOff back.sceneMotion
                    , \_ ->
                        Expect.all
                            [ \o -> Expect.equal [ AppearanceStoreSceneMotion { value = "off" } ] (List.take 1 o)
                            , \o -> Expect.equal True (List.all isApply (List.drop 1 o) && List.length o == 2)
                            ]
                            backOut
                    ]
                    ()
        , test "staging a known background does not persist" <|
            \_ ->
                let
                    ( next, outbounds ) =
                        update (AppearanceStageBackground { id = "deep-current" }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal "deep-current" next.backgroundCandidate
                    , \_ -> Expect.equal "ember" next.backgroundId
                    , \_ -> Expect.equal True (backgroundDirty next)
                    , \_ -> Expect.equal [ BackgroundPreviewRequest { id = "" } ] outbounds
                    ]
                    ()
        , test "staging an unknown background is a silent no-op" <|
            \_ ->
                Expect.equal ( seeded, [] )
                    (update (AppearanceStageBackground { id = "nope" }) seeded)
        , test "hover asks ports-side for a delayed preview" <|
            \_ ->
                Expect.equal
                    ( seeded, [ BackgroundPreviewRequest { id = "deep-current" } ] )
                    (update (AppearancePreviewBackground { id = "deep-current" }) seeded)
        , test "a preview landing off-route never paints" <|
            \_ ->
                Expect.equal ( seeded, [] )
                    (update (AppearancePreviewed { id = "deep-current" }) seeded)
        , test "a preview landing on-route paints the staged render" <|
            \_ ->
                let
                    onRoute =
                        { seeded | route = Route.Appearance }

                    ( next, _ ) =
                        update (AppearancePreviewed { id = "deep-current" }) onRoute
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "deep-current") next.backgroundPreview
                    , \_ -> Expect.equal "deep-current" (renderedBackground next)
                    ]
                    ()
        , test "applying a staged background stores it and re-applies" <|
            \_ ->
                let
                    ( staged, _ ) =
                        update (AppearanceStageBackground { id = "deep-current" }) seeded

                    ( next, outbounds ) =
                        update AppearanceApplyBackground staged
                in
                Expect.all
                    [ \_ -> Expect.equal "deep-current" next.backgroundId
                    , \_ -> Expect.equal False (backgroundDirty next)
                    , \_ ->
                        Expect.all
                            [ \o -> Expect.equal [ AppearanceStoreBackground { id = "deep-current" } ] (List.take 1 o)
                            , \o -> Expect.equal True (List.all isApply (List.drop 1 o) && List.length o == 2)
                            ]
                            outbounds
                    ]
                    ()
        , test "applying with nothing staged is a silent no-op" <|
            \_ ->
                Expect.equal ( seeded, [] )
                    (update AppearanceApplyBackground seeded)
        , test "cancel restores the stored background" <|
            \_ ->
                let
                    ( staged, _ ) =
                        update (AppearanceStageBackground { id = "deep-current" }) seeded

                    ( next, outbounds ) =
                        update AppearanceCancelBackground staged
                in
                Expect.all
                    [ \_ -> Expect.equal "ember" next.backgroundCandidate
                    , \_ -> Expect.equal False (backgroundDirty next)
                    , \_ -> Expect.equal [] outbounds
                    ]
                    ()
        , test "arrow keys walk the look list and apply" <|
            \_ ->
                let
                    ids =
                        [ "ocean", "tide", "abyss" ]

                    ( next, outbounds ) =
                        update (AppearanceRadioKey { ids = ids, current = "tide", key = "ArrowRight" }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal "abyss" next.themeId
                    , \_ ->
                        Expect.all
                            [ \o -> Expect.equal [ AppearanceStoreTheme { id = "abyss" } ] (List.take 1 o)
                            , \o -> Expect.equal True (List.all isApply (List.drop 1 o) && List.length o == 2)
                            ]
                            outbounds
                    ]
                    ()
        , test "arrow keys wrap around the look list" <|
            \_ ->
                Expect.equal "ocean"
                    (Tuple.first
                        (update (AppearanceRadioKey { ids = [ "ocean", "tide", "abyss" ], current = "abyss", key = "ArrowRight" }) seeded)
                    ).themeId
        , test "unhandled radio keys stay silent" <|
            \_ ->
                Expect.equal ( seeded, [] )
                    (update (AppearanceRadioKey { ids = [ "ocean", "tide" ], current = "tide", key = "Enter" }) seeded)
        , test "rendered background resolves auto through the theme signature" <|
            \_ ->
                Expect.equal "caustics"
                    (renderedBackground { seeded | backgroundId = ThemeLook.autoBackgroundId, backgroundCandidate = ThemeLook.autoBackgroundId })
        ]
