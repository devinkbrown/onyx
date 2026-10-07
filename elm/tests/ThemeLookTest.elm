module ThemeLookTest exposing (suite)

{-| Theme-look parity vectors, mirroring `src/theme/themes.test.ts`,
`publicLooks.test.ts`, `themeStorage.test.ts`, and the catalogue
picker groups: registry meta, legacy remaps, default look entries,
background resolve, and the custom-theme slot.
-}

import Expect
import Test exposing (Test, describe, test)
import ThemeLook exposing (..)


customs : List CustomThemeRef
customs =
    [ { id = "custom:mine", name = "Mine", base = "ocean" } ]


suite : Test
suite =
    describe "ThemeLook"
        [ test "registry pins eighteen themes with swatches and signatures" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal 18 (List.length themeMeta)
                    , \_ ->
                        Expect.equal [ "ocean", "tide", "abyss", "reef", "onyx", "obsidian", "pearl", "ink", "shu", "hisui", "pine", "kohaku", "terracotta", "vermillion", "sapphire", "teal", "slate", "frost" ]
                            themeIds
                    , \_ -> Expect.equal "ocean" defaultThemeId
                    , \_ -> Expect.equal True (isPublicThemeId "ocean")
                    , \_ -> Expect.equal True (isPublicThemeId "pearl")
                    , \_ -> Expect.equal False (isPublicThemeId "tide")
                    , \_ ->
                        Expect.equal True
                            (List.all (\meta -> List.length meta.swatch == 3 && not (String.isEmpty meta.signatureBg)) themeMeta)
                    , \_ ->
                        Expect.equal [ "#65adf5", "#b4bfca", "#343b43" ]
                            (themeMeta |> List.filter (\meta -> meta.id == "ocean") |> List.head |> Maybe.map .swatch |> Maybe.withDefault [])
                    , \_ ->
                        Expect.equal [ "#2bb4f0", "#d8b96a", "#0f2740" ]
                            (swatchFromTokens [])
                    , \_ ->
                        Expect.equal [ "#111", "#d8b96a", "#0f2740" ]
                            (swatchFromTokens [ ( "--accent", "#111" ) ])
                    ]
                    ()
        , test "normalizeThemeId remaps legacy aliases and rejects unknown" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "ocean") (normalizeThemeId "midnight" [])
                    , \_ -> Expect.equal (Just "shu") (normalizeThemeId "lacquer" [])
                    , \_ -> Expect.equal (Just "ocean") (normalizeThemeId "ocean" [])
                    , \_ -> Expect.equal (Just "custom:mine") (normalizeThemeId "custom:mine" customs)
                    , \_ -> Expect.equal Nothing (normalizeThemeId "custom:ghost" customs)
                    , \_ -> Expect.equal Nothing (normalizeThemeId "nope" [])
                    , \_ -> Expect.equal Nothing (normalizeThemeId "" [])
                    ]
                    ()
        , test "default look entries add the active look only when outside" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal [ "ocean", "pearl" ]
                            (List.map .id (buildDefaultLookEntries "ocean" customs))
                    , \_ ->
                        Expect.equal [ "ocean", "pearl", "tide" ]
                            (List.map .id (buildDefaultLookEntries "tide" customs))
                    , \_ ->
                        Expect.equal [ "Ocean · Dark", "Pearl · Light" ]
                            (List.map .label (buildDefaultLookEntries "ocean" customs))
                    , \_ ->
                        Expect.equal [ "ocean", "pearl", "custom:mine" ]
                            (List.map .id (buildDefaultLookEntries "custom:mine" customs))
                    , \_ ->
                        Expect.equal [ "ocean", "pearl" ]
                            (List.map .id (buildDefaultLookEntries "custom:ghost" customs))
                    , \_ ->
                        Expect.equal True
                            (buildDefaultLookEntries "tide" customs
                                |> List.filter (\entry -> entry.id == "tide")
                                |> List.head
                                |> Maybe.map .extra
                                |> Maybe.withDefault False
                            )
                    ]
                    ()
        , test "custom theme refs decode fail-closed" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (decodeCustomThemeRefs "null")
                    , \_ -> Expect.equal [] (decodeCustomThemeRefs "[]")
                    , \_ ->
                        Expect.equal customs
                            (decodeCustomThemeRefs "[{\"id\":\"custom:mine\",\"name\":\"Mine\",\"base\":\"ocean\",\"overrides\":{}}]")
                    , \_ ->
                        Expect.equal []
                            (decodeCustomThemeRefs "[{\"id\":\"mine\",\"name\":\"Mine\",\"base\":\"ocean\"}]")
                    , \_ ->
                        Expect.equal []
                            (decodeCustomThemeRefs "[{\"id\":\"custom:mine\",\"name\":\"Mine\",\"base\":\"nope\"}]")
                    ]
                    ()
        , test "background resolve follows the theme or pins" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "deep-current" (resolveBackgroundId "auto" "ocean" [])
                    , \_ -> Expect.equal "paper-grain" (resolveBackgroundId "" "pearl" [])
                    , \_ -> Expect.equal "mist" (resolveBackgroundId "nope" "slate" [])
                    , \_ -> Expect.equal "starfield" (resolveBackgroundId "starfield" "ocean" [])
                    , \_ -> Expect.equal "deep-current" (resolveBackgroundId "auto" "custom:mine" customs)
                    , \_ -> Expect.equal "deep-current" (resolveBackgroundId "auto" "custom:ghost" [])
                    , \_ -> Expect.equal "auto" autoBackgroundId
                    ]
                    ()
        , test "picker groups order the catalogue" <|
            \_ ->
                let
                    groups =
                        backgroundGroups

                    kinds group =
                        List.map .kind group
                in
                Expect.all
                    [ \_ ->
                        Expect.equal [ "Match my theme", "Living ambient", "Quiet stills", "Featured scenes", "More presets" ]
                            (List.map Tuple.first groups)
                    , \_ ->
                        Expect.equal [ "auto" ]
                            (groups |> List.head |> Maybe.map (Tuple.second >> List.map .id) |> Maybe.withDefault [])
                    , \_ ->
                        Expect.equal True
                            (groups
                                |> List.drop 1
                                |> List.head
                                |> Maybe.map (Tuple.second >> kinds >> List.all (\kind -> kind == BackgroundAnimated))
                                |> Maybe.withDefault False
                            )
                    , \_ ->
                        Expect.equal 24 (List.length backgroundOptions)
                    ]
                    ()
        ]
