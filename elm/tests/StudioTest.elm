module StudioTest exposing (suite)

{-| Theme Studio pure-core vectors, mirroring
`src/theme/customThemes.test.ts`, `src/theme/themeImport.test.ts`,
`src/theme/seedTransfer.test.ts`, and
`src/lib/theme/themeShare.test.ts`.
-}

import Dict
import Expect
import Json.Decode as Decode
import Json.Encode as Encode
import Studio exposing (..)
import Test exposing (Test, describe, test)
import Theme
import ThemeTokens


builtinIds : List String
builtinIds =
    ThemeTokens.themeIds


tokenMapValue : List ( String, String ) -> Decode.Value
tokenMapValue pairs =
    Encode.object (List.map (\( key, value ) -> ( key, Encode.string value )) pairs)


safeMap : List ( String, String )
safeMap =
    [ ( "--lapis", "#78d5ff" )
    , ( "--brand-action", "#ff987d" )
    , ( "--paper", "oklch(92% 0.02 220)" )
    , ( "--seam", "color-mix(in oklab, var(--lapis) 38%, transparent)" )
    , ( "--r-sm", "8px" )
    , ( "--dur", "260ms" )
    , ( "--ease", "cubic-bezier(0.16, 1, 0.3, 1)" )
    , ( "--font-mono", "'JetBrains Mono Variable', ui-monospace, monospace" )
    ]


minimalTheme : CustomTheme
minimalTheme =
    { id = "custom:mistline"
    , name = "Mistline"
    , base = "ocean"
    , overrides =
        Dict.fromList
            [ ( "--lapis", "#78d5ff" )
            , ( "--paper", "oklch(92% 0.02 220)" )
            , ( "--font-mono", "'JetBrains Mono Variable', monospace" )
            ]
    }


safeSeed : Theme.PaletteSeed
safeSeed =
    { scheme = "dark"
    , primaryHue = 205
    , accentHue = 158
    , depth = 0.7
    , vibrancy = 0.55
    , warmth = 0.1
    , contrast = 8
    }


themeJson : String -> String -> String -> Decode.Value -> String
themeJson id name base overrides =
    Encode.encode 0
        (Encode.object
            [ ( "id", Encode.string id )
            , ( "name", Encode.string name )
            , ( "base", Encode.string base )
            , ( "overrides", overrides )
            ]
        )


exportBlob : Decode.Value -> String -> String
exportBlob overrides exported =
    Encode.encode 0
        (Encode.object
            [ ( "__onyx_theme_export__", Encode.bool True )
            , ( "base", Encode.string "ocean" )
            , ( "overrides", overrides )
            , ( "exported", Encode.string exported )
            ]
        )


seedEnvelope : String -> String
seedEnvelope seedJson =
    "{\"kind\":\"onyx-theme-seed\",\"version\":1,\"label\":\"x\",\"seed\":" ++ seedJson ++ "}"


suite : Test
suite =
    describe "Studio"
        [ describe "registry"
            [ test "seven groups in oracle order" <|
                \_ ->
                    Expect.equal
                        [ "surfaces", "accents", "text", "seams", "radius", "motion", "fonts" ]
                        (List.map .id studioGroups)
            , test "27 editable tokens" <|
                \_ ->
                    Expect.equal 27 (List.length allStudioTokens)
            , test "radius and duration sliders carry bounds" <|
                \_ ->
                    case List.filter (\token -> token.property == "--dur") allStudioTokens of
                        [ token ] ->
                            Expect.equal (Just 600) token.max

                        _ ->
                            Expect.fail "missing --dur token"
            ]
        , describe "token grammar"
            [ test "accepts the finite safe grammar" <|
                \_ ->
                    Expect.equal (Just (Dict.fromList safeMap))
                        (parseCustomThemeTokenMap (tokenMapValue safeMap))
            , test "accepts every built-in token map" <|
                \_ ->
                    Expect.equal []
                        (List.filter
                            (\id ->
                                parseCustomThemeTokenMap
                                    (Encode.object
                                        (Dict.toList (ThemeTokens.tokensFor id)
                                            |> List.map (\( key, value ) -> ( key, Encode.string value ))
                                        )
                                    )
                                    == Nothing
                            )
                            builtinIds
                        )
            , test "rejects hostile values before CSSOM" <|
                \_ ->
                    Expect.equal []
                        (List.filter
                            (\( property, value ) -> isSafeCustomThemeToken property value)
                            [ ( "--stone", "url(https://attacker.example/pixel)" )
                            , ( "--stone", "u\\72l(https://attacker.example/pixel)" )
                            , ( "--stone", "@import \"https://attacker.example/theme.css\"" )
                            , ( "--stone", "#fff; background: red" )
                            , ( "--stone", "#fff} body { color: red" )
                            , ( "--stone", "var(--attacker-controlled)" )
                            , ( "--stone", "var(--lapis, url(https://attacker.example/pixel))" )
                            , ( "--brand-action", "url(https://attacker.example/pixel)" )
                            , ( "--brand-action", "var(--attacker-controlled)" )
                            , ( "--brand-action", "var(--brand-action, url(https://attacker.example/pixel))" )
                            , ( "--stone", "linear-gradient(#fff, #000)" )
                            , ( "--external-image", "#fff" )
                            ]
                        )
            , test "radius, duration, and easing bounds hold" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (isSafeCustomThemeToken "--r-sm" "8px")
                        , \_ -> Expect.equal False (isSafeCustomThemeToken "--r-sm" "13px")
                        , \_ -> Expect.equal False (isSafeCustomThemeToken "--r-md" "17px")
                        , \_ -> Expect.equal True (isSafeCustomThemeToken "--r-pill" "999px")
                        , \_ -> Expect.equal True (isSafeCustomThemeToken "--dur" "260ms")
                        , \_ -> Expect.equal False (isSafeCustomThemeToken "--dur" "5001ms")
                        , \_ -> Expect.equal False (isSafeCustomThemeToken "--ease" "cubic-bezier(2, 0, 0, 0)")
                        , \_ -> Expect.equal True (isSafeCustomThemeToken "--ease" "steps(4, jump-none)")
                        ]
                        ()
            ]
        , describe "custom themes"
            [ test "custom ids never collide with built-ins" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (isCustomThemeId "custom:my-theme")
                        , \_ -> Expect.equal False (isCustomThemeId "ocean")
                        ]
                        ()
            , test "add derives ids from the name and uniquifies" <|
                \_ ->
                    let
                        ( first, kept ) =
                            addCustomTheme builtinIds [] "My Theme" "ocean" (Dict.fromList [ ( "--lapis", "#ff0000" ) ])

                        ( second, _ ) =
                            addCustomTheme builtinIds kept "Dup" "ocean" Dict.empty

                        ( third, _ ) =
                            addCustomTheme builtinIds (kept ++ [ second ]) "Dup" "ocean" Dict.empty
                    in
                    Expect.all
                        [ \_ -> Expect.equal "custom:my-theme" first.id
                        , \_ -> Expect.equal "custom:dup" second.id
                        , \_ -> Expect.equal "custom:dup-2" third.id
                        ]
                        ()
            , test "one unsafe override discards the whole map" <|
                \_ ->
                    let
                        ( theme, _ ) =
                            addCustomTheme builtinIds
                                []
                                "No beacon"
                                "ocean"
                                (Dict.fromList [ ( "--stone", "url(https://attacker.example/pixel)" ) ])
                    in
                    Expect.equal Dict.empty theme.overrides
            , test "remove drops by id" <|
                \_ ->
                    let
                        ( theme, kept ) =
                            addCustomTheme builtinIds [] "Gone" "abyss" Dict.empty
                    in
                    Expect.equal [] (removeCustomTheme kept theme.id)
            , test "effective tokens overlay the base" <|
                \_ ->
                    let
                        ( theme, _ ) =
                            addCustomTheme builtinIds [] "Red" "ocean" (Dict.fromList [ ( "--lapis", "#ff0000" ) ])

                        tokens =
                            customThemeTokens (ThemeTokens.tokensFor "ocean") theme
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "#ff0000") (Dict.get "--lapis" tokens)
                        , \_ -> Expect.equal (Dict.get "--gold" (ThemeTokens.tokensFor "ocean")) (Dict.get "--gold" tokens)
                        ]
                        ()
            , test "scheme inherits the base" <|
                \_ ->
                    let
                        schemeOf id =
                            if id == "ocean" then
                                Just "dark"

                            else if id == "pearl" then
                                Just "light"

                            else
                                Nothing

                        ( dark, _ ) =
                            addCustomTheme builtinIds [] "D" "ocean" Dict.empty

                        ( light, _ ) =
                            addCustomTheme builtinIds [] "L" "pearl" Dict.empty
                    in
                    Expect.all
                        [ \_ -> Expect.equal "dark" (customThemeScheme schemeOf dark)
                        , \_ -> Expect.equal "light" (customThemeScheme schemeOf light)
                        ]
                        ()
            , test "revive keeps the safe sibling and drops the hostile one" <|
                \_ ->
                    Expect.equal [ "custom:safe-sibling" ]
                        (List.map .id
                            (reviveCustomThemes builtinIds
                                ("["
                                    ++ themeJson "custom:unsafe-resource" "Unsafe resource" "ocean" (tokenMapValue [ ( "--stone", "url(https://attacker.example/pixel)" ) ])
                                    ++ ","
                                    ++ themeJson "custom:safe-sibling" "Safe sibling" "ocean" (tokenMapValue [ ( "--stone", "#123456" ) ])
                                    ++ "]"
                                )
                            )
                        )
            , test "revive rejects malformed entries without dropping valid ones" <|
                \_ ->
                    Expect.equal [ "custom:good" ]
                        (List.map .id
                            (reviveCustomThemes builtinIds
                                ("["
                                    ++ themeJson "custom:good" "Good" "ocean" (tokenMapValue [ ( "--lapis", "#00ace9" ) ])
                                    ++ ",{\"id\":\"ocean\",\"name\":\"Built-in collision\",\"base\":\"ocean\",\"overrides\":{}}"
                                    ++ ",{\"id\":\"custom:missing-base\",\"name\":\"Missing base\",\"overrides\":{}}"
                                    ++ ",{\"id\":\"custom:bad-base\",\"name\":\"Bad base\",\"base\":\"does-not-exist\",\"overrides\":{}}"
                                    ++ ",{\"id\":\"custom:UPPER\",\"name\":\"Upper\",\"base\":\"ocean\",\"overrides\":{}}"
                                    ++ ",{\"id\":\"custom:control\",\"name\":\"Bad\\nName\",\"base\":\"ocean\",\"overrides\":{}}"
                                    ++ "]"
                                )
                            )
                        )
            , test "revive keeps first-id-wins on duplicates" <|
                \_ ->
                    Expect.equal [ "First" ]
                        (List.map .name
                            (reviveCustomThemes builtinIds
                                ("["
                                    ++ themeJson "custom:dup" "First" "ocean" (Encode.object [])
                                    ++ ","
                                    ++ themeJson "custom:dup" "Second" "ocean" (Encode.object [])
                                    ++ "]"
                                )
                            )
                        )
            , test "oversized storage revives empty" <|
                \_ ->
                    Expect.equal [] (reviveCustomThemes builtinIds (String.repeat (256 * 1024 + 1) " "))
            , test "slugify mirrors the oracle" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "my-theme" (slugifyThemeName "My Theme")
                        , \_ -> Expect.equal "theme" (slugifyThemeName "!!!")
                        , \_ -> Expect.equal "caf" (slugifyThemeName "Café!")
                        ]
                        ()
            ]
        , describe "theme export"
            [ test "reconstructs a bounded valid export" <|
                \_ ->
                    Expect.equal
                        (Ok
                            { base = "ocean"
                            , overrides = Dict.fromList [ ( "--lapis", "#00ace9" ) ]
                            , exported = "2026-07-16T18:00:00.000Z"
                            }
                        )
                        (parseThemeExport builtinIds (exportBlob (tokenMapValue [ ( "--lapis", "#00ace9" ) ]) "2026-07-16T18:00:00.000Z"))
            , test "rejects oversized input before parsing" <|
                \_ ->
                    Expect.equal (Err "Theme export is too large.")
                        (parseThemeExport builtinIds (String.repeat (64 * 1024 + 1) " "))
            , test "rejects marker-only and null override payloads" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Err "Not a valid Onyx theme export.") (parseThemeExport builtinIds "{\"__onyx_theme_export__:true}")
                        , \_ -> Expect.equal (Err "Not a valid Onyx theme export.") (parseThemeExport builtinIds (exportBlob Encode.null "2026-07-16T18:00:00.000Z"))
                        ]
                        ()
            , test "names unknown prototype bases" <|
                \_ ->
                    Expect.equal (Err "Unknown base theme \"toString\".")
                        (parseThemeExport builtinIds
                            (Encode.encode 0
                                (Encode.object
                                    [ ( "__onyx_theme_export__", Encode.bool True )
                                    , ( "base", Encode.string "toString" )
                                    , ( "overrides", Encode.object [] )
                                    , ( "exported", Encode.string "2026-07-16T18:00:00.000Z" )
                                    ]
                                )
                            )
                        )
            , test "rejects invalid export timestamps" <|
                \_ ->
                    Expect.equal (Err "Not a valid Onyx theme export.")
                        (parseThemeExport builtinIds (exportBlob (tokenMapValue [ ( "--lapis", "#00ace9" ) ]) "eventually"))
            ]
        , describe "seed transfer"
            [ test "round-trips a seed and label losslessly" <|
                \_ ->
                    case parseThemeSeed (exportThemeSeed "Deep Water" safeSeed) of
                        Ok result ->
                            Expect.all
                                [ \_ -> Expect.equal "Deep Water" result.label
                                , \_ -> Expect.equal safeSeed result.seed
                                , \_ -> Expect.equal [] result.warnings
                                ]
                                ()

                        Err error ->
                            Expect.fail error
            , test "trims and caps the label, blank falls back to Custom" <|
                \_ ->
                    case ( Decode.decodeString (Decode.field "label" Decode.string) (exportThemeSeed ("  " ++ String.repeat 200 "a" ++ "  ") safeSeed), Decode.decodeString (Decode.field "label" Decode.string) (exportThemeSeed "   " safeSeed) ) of
                        ( Ok long, Ok blank ) ->
                            Expect.all
                                [ \_ -> Expect.equal 80 (String.length long)
                                , \_ -> Expect.equal "Custom" blank
                                ]
                                ()

                        _ ->
                            Expect.fail "label envelope decode failed"
            , test "round-trips randomised seeds" <|
                \_ ->
                    Expect.equal []
                        (List.range 0 49
                            |> List.filterMap
                                (\i ->
                                    let
                                        seed =
                                            Theme.randomSeed i
                                    in
                                    case parseThemeSeed (exportThemeSeed ("seed-" ++ String.fromInt i) seed) of
                                        Ok result ->
                                            if result.seed == seed then
                                                Nothing

                                            else
                                                Just i

                                        Err _ ->
                                            Just i
                                )
                        )
            , test "fail-closed parsing" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Err "Invalid JSON — could not parse.") (parseThemeSeed "{not json" |> Result.map (\_ -> ""))
                        , \_ -> Expect.equal (Err "Theme-seed export is too large.") (parseThemeSeed (String.repeat (16 * 1024 + 1) " ") |> Result.map (\_ -> ""))
                        , \_ -> Expect.equal True (parseThemeSeed "[]" |> Result.toMaybe |> (==) Nothing)
                        , \_ -> Expect.equal True (parseThemeSeed "{\"kind\":\"other\",\"version\":1,\"label\":\"x\",\"seed\":{}}" |> Result.toMaybe |> (==) Nothing)
                        , \_ -> Expect.equal True (parseThemeSeed (seedEnvelope "{\"scheme\":\"dark\",\"primaryHue\":-1,\"accentHue\":158,\"depth\":0.7,\"vibrancy\":0.55,\"warmth\":0.1,\"contrast\":8}") |> Result.toMaybe |> (==) Nothing)
                        , \_ -> Expect.equal True (parseThemeSeed (seedEnvelope "{\"scheme\":\"twilight\",\"primaryHue\":205,\"accentHue\":158,\"depth\":0.7,\"vibrancy\":0.55,\"warmth\":0.1,\"contrast\":8}") |> Result.toMaybe |> (==) Nothing)
                        , \_ -> Expect.equal True (parseThemeSeed (seedEnvelope "{\"scheme\":\"dark\",\"primaryHue\":null,\"accentHue\":158,\"depth\":0.7,\"vibrancy\":0.55,\"warmth\":0.1,\"contrast\":8}") |> Result.toMaybe |> (==) Nothing)
                        , \_ -> Expect.equal True (parseThemeSeed (seedEnvelope "{\"scheme\":\"dark\",\"primaryHue\":205,\"accentHue\":158,\"depth\":\"0.5\",\"vibrancy\":0.55,\"warmth\":0.1,\"contrast\":8}") |> Result.toMaybe |> (==) Nothing)
                        , \_ -> Expect.equal True (parseThemeSeed (seedEnvelope "{\"scheme\":\"dark\",\"primaryHue\":205,\"accentHue\":158,\"depth\":0.7,\"vibrancy\":0.55,\"warmth\":0.1,\"contrast\":4}") |> Result.toMaybe |> (==) Nothing)
                        ]
                        ()
            , test "flags banned hues without rejecting" <|
                \_ ->
                    case parseThemeSeed (exportThemeSeed "Purple" { safeSeed | primaryHue = 300, accentHue = 320 }) of
                        Ok result ->
                            Expect.equal 2 (List.length result.warnings)

                        Err error ->
                            Expect.fail error
            ]
        , describe "share codes"
            [ test "round-trips a custom theme" <|
                \_ ->
                    Expect.equal (Just minimalTheme)
                        (decodeThemeShare builtinIds (encodeThemeShare builtinIds minimalTheme))
            , test "rejects junk, non-JSON, and malformed themes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (decodeThemeShare builtinIds "%not-base64%")
                        , \_ -> Expect.equal Nothing (decodeThemeShare builtinIds "bm90LWpzb24")
                        , \_ -> Expect.equal Nothing (decodeThemeShare builtinIds (encodeThemeShare builtinIds { minimalTheme | id = "ocean" }))
                        , \_ -> Expect.equal Nothing (decodeThemeShare builtinIds (String.repeat 65537 "a"))
                        ]
                        ()
            , test "does not encode a runtime-invalid theme" <|
                \_ ->
                    Expect.equal "" (encodeThemeShare builtinIds { minimalTheme | name = String.repeat 81 "x" })
            , test "share URL round-trips through the param" <|
                \_ ->
                    let
                        url =
                            themeShareUrl builtinIds minimalTheme "https://onyx.local/app"

                        code =
                            String.dropLeft (String.length "https://onyx.local/app?theme=") url
                    in
                    Expect.equal (Just minimalTheme) (decodeThemeShare builtinIds code)
            ]
        , describe "strict UTF-8"
            [ test "decodes ASCII and multi-byte sequences" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "A") (utf8DecodeStrict [ 0x41 ])
                        , \_ -> Expect.equal (Just "é") (utf8DecodeStrict [ 0xC3, 0xA9 ])
                        , \_ -> Expect.equal (Just "€") (utf8DecodeStrict [ 0xE2, 0x82, 0xAC ])
                        , \_ -> Expect.equal (Just "🌊") (utf8DecodeStrict [ 0xF0, 0x9F, 0x8C, 0x8A ])
                        ]
                        ()
            , test "rejects overlongs, surrogates, truncations, strays" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (utf8DecodeStrict [ 0xC0, 0xAF ])
                        , \_ -> Expect.equal Nothing (utf8DecodeStrict [ 0xED, 0xA0, 0x80 ])
                        , \_ -> Expect.equal Nothing (utf8DecodeStrict [ 0xE2, 0x82 ])
                        , \_ -> Expect.equal Nothing (utf8DecodeStrict [ 0x80 ])
                        , \_ -> Expect.equal Nothing (utf8DecodeStrict [ 0xF4, 0x90, 0x80, 0x80 ])
                        ]
                        ()
            ]
        , describe "contrast audit"
            [ test "ocean grades all eight pairs with none below AA" <|
                \_ ->
                    let
                        rows =
                            auditContrast (ThemeTokens.tokensFor "ocean")
                    in
                    Expect.all
                        [ \_ -> Expect.equal 8 (List.length rows)
                        , \_ -> Expect.equal True (List.all (\row -> row.ratio /= Nothing) rows)
                        , \_ -> Expect.equal 0 (auditFailing (ThemeTokens.tokensFor "ocean") rows)
                        ]
                        ()
            , test "a black-on-ink override fails body text" <|
                \_ ->
                    let
                        tokens =
                            Dict.insert "--paper" "#000000" (ThemeTokens.tokensFor "ocean")

                        rows =
                            auditContrast tokens
                    in
                    Expect.equal True (auditFailing tokens rows > 0)
            , test "a color-mix override grades n/a instead of failing" <|
                \_ ->
                    let
                        tokens =
                            Dict.insert "--paper" "color-mix(in oklab, #ffffff 50%, transparent)" (ThemeTokens.tokensFor "ocean")

                        rows =
                            auditContrast tokens
                    in
                    case List.filter (\row -> row.label == "Body text") rows of
                        [ row ] ->
                            Expect.equal Nothing row.ratio

                        _ ->
                            Expect.fail "missing body row"
            , test "badge classes hyphenate AA Large" <|
                \_ ->
                    Expect.equal "aa-large" (auditBadgeClass "AA Large")
            ]
        , describe "fold helpers"
            [ test "diff drops base-equal entries" <|
                \_ ->
                    Expect.equal (Dict.fromList [ ( "--lapis", "#ff0000" ) ])
                        (diffOverrides (Dict.fromList [ ( "--lapis", "#00ace9" ), ( "--gold", "#b4bfca" ) ])
                            (Dict.fromList [ ( "--lapis", "#ff0000" ), ( "--gold", "#b4bfca" ) ])
                        )
            , test "signed readouts match the oracle format" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "+1.20" (fmtSigned 1.2)
                        , \_ -> Expect.equal "-0.35" (fmtSigned -0.35)
                        , \_ -> Expect.equal "+0.00" (fmtSigned 0)
                        ]
                        ()
            , test "scheme correction anchors cross-scheme saves" <|
                \_ ->
                    let
                        schemeOf id =
                            if id == "pearl" then
                                Just "light"

                            else
                                Just "dark"
                    in
                    Expect.all
                        [ \_ -> Expect.equal "ocean" (schemeCorrectedBase schemeOf "ocean" Nothing)
                        , \_ -> Expect.equal "ocean" (schemeCorrectedBase schemeOf "ocean" (Just "dark"))
                        , \_ -> Expect.equal "pearl" (schemeCorrectedBase schemeOf "ocean" (Just "light"))
                        , \_ -> Expect.equal "pearl" (schemeCorrectedBase schemeOf "pearl" (Just "light"))
                        ]
                        ()
            , test "save suggestion names customs and bases" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Mistline" (saveSuggestion True "Mistline" "Ocean")
                        , \_ -> Expect.equal "Ocean custom" (saveSuggestion False "" "Ocean")
                        ]
                        ()
            , test "save merge folds session over saved" <|
                \_ ->
                    Expect.equal (Dict.fromList [ ( "--lapis", "#ff0000" ), ( "--gold", "#111111" ) ])
                        (mergeSaveOverrides
                            (Dict.fromList [ ( "--lapis", "#00ace9" ), ( "--gold", "#111111" ) ])
                            (Dict.fromList [ ( "--lapis", "#ff0000" ) ])
                        )
            , test "eye-dropper hex classifies to a rounded hue" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (sampledAccentSeed "#FF0000" /= Nothing)
                        , \_ -> Expect.equal Nothing (sampledAccentSeed "red")
                        , \_ -> Expect.equal Nothing (sampledAccentSeed "#fff")
                        ]
                        ()
            , test "seed swatches come from the engine" <|
                \_ ->
                    let
                        swatches =
                            seedSwatches Theme.defaultSeed
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (String.startsWith "#" swatches.primary)
                        , \_ -> Expect.equal True (String.startsWith "#" swatches.accent)
                        ]
                        ()
            ]
        ]
