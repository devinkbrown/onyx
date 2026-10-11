module ShellPaletteTest exposing (suite)

{-| v3/gap-appearance — theme → shell token derivation (`ShellPalette`):
Ocean reproduces the house palette exactly, every built-in palette
clears AA on its own surfaces without repair (and the high-contrast
variant one rung up), anchors yield to Studio edits, generated and
hostile palettes still come out AA, and the commit is `#rrggbb` only.
-}

import Dict exposing (Dict)
import Expect
import Regex
import ShellPalette
import Studio
import Test exposing (Test, describe, test)
import Theme
import ThemeTokens


shellFor : String -> Bool -> ShellPalette.Shell
shellFor id hc =
    ShellPalette.derive { themeId = id, base = ThemeTokens.tokensFor id, tokens = ThemeTokens.tokensFor id, highContrast = hc }


resolveHex : Dict String String -> String -> Maybe String
resolveHex tokens name =
    Dict.get name tokens
        |> Maybe.andThen (\value -> Studio.resolveTokenColor tokens value 0)
        |> Maybe.map Theme.rgbToHex


house : ShellPalette.Shell
house =
    { bg = "#0b0e12"
    , panel = "#12161c"
    , panel2 = "#181e27"
    , line = "#232b36"
    , text = "#e8e6e1"
    , dim = "#9aa3ad"
    , faint = "#5d6670"
    , accent = "#46c08a"
    , accentInk = "#06281a"
    , warn = "#d9a13b"
    , bad = "#e5484d"
    , success = "#46c08a"
    }


hexOnly : String -> Bool
hexOnly value =
    case Regex.fromString "^#[0-9a-f]{6}$" of
        Just re ->
            Regex.contains re value

        Nothing ->
            False


suite : Test
suite =
    describe "ShellPalette"
        [ test "Ocean (the default look) derives exactly the v3 house palette" <|
            \_ -> Expect.equal house (shellFor "ocean" False)
        , test "every built-in theme clears AA on its own surfaces" <|
            \_ ->
                Expect.equal []
                    (List.concatMap
                        (\id -> List.map (\f -> id ++ ": " ++ f) (ShellPalette.contrastFailures False (shellFor id False)))
                        ThemeTokens.themeIds
                    )
        , test "every built-in palette passes without repair (the palette itself is AA)" <|
            \_ ->
                Expect.equal []
                    (List.concatMap
                        (\id ->
                            let
                                tokens =
                                    ThemeTokens.tokensFor id

                                shell =
                                    shellFor id False

                                same label derived source =
                                    if id == "ocean" || Just derived == resolveHex tokens source then
                                        []

                                    else
                                        [ id ++ " " ++ label ++ " repaired to " ++ derived ]
                            in
                            same "text" shell.text "--paper"
                                ++ same "dim" shell.dim "--paper-dim"
                                ++ same "faint" shell.faint "--paper-mute"
                                ++ same "accent" shell.accent "--lapis"
                                ++ same "warn" shell.warn "--warn"
                                ++ same "bad" shell.bad "--danger"
                                ++ same "success" shell.success "--ok"
                        )
                        ThemeTokens.themeIds
                    )
        , test "every built-in theme's high-contrast variant clears one rung up" <|
            \_ ->
                Expect.equal []
                    (List.concatMap
                        (\id -> List.map (\f -> id ++ " HC: " ++ f) (ShellPalette.contrastFailures True (shellFor id True)))
                        ThemeTokens.themeIds
                    )
        , test "high contrast only ever raises contrast (never moves the grounds)" <|
            \_ ->
                Expect.equal []
                    (List.filter
                        (\id ->
                            let
                                a =
                                    shellFor id False

                                b =
                                    shellFor id True
                            in
                            a.bg /= b.bg || a.panel /= b.panel || a.panel2 /= b.panel2
                        )
                        ThemeTokens.themeIds
                    )
        , test "light looks derive light shells; dark looks dark ones" <|
            \_ ->
                Expect.equal [ "frost", "pearl" ]
                    (List.filter (\id -> ShellPalette.isLight (shellFor id False)) ThemeTokens.themeIds |> List.sort)
        , test "a Studio edit to a source token releases only that slot's anchor (the rest stay guarded house values)" <|
            \_ ->
                let
                    base =
                        ThemeTokens.tokensFor "ocean"

                    edited =
                        Dict.insert "--stone" "#334455" base

                    shell =
                        ShellPalette.derive { themeId = "ocean", base = base, tokens = edited, highContrast = False }
                in
                Expect.all
                    [ \s -> Expect.equal "#334455" s.panel
                    , \s -> Expect.equal house.bg s.bg
                    , \s -> Expect.equal house.text s.text
                    , \s -> Expect.notEqual "#65adf5" s.accent
                    , \s -> Expect.equal [] (ShellPalette.contrastFailures False s)
                    ]
                    shell
        , test "a custom theme on the ocean base re-derives from its overrides" <|
            \_ ->
                let
                    base =
                        ThemeTokens.tokensFor "ocean"

                    generated =
                        Dict.union (Theme.generatePalette { scheme = "light", primaryHue = 160, accentHue = 30, depth = 0.4, vibrancy = 0.5, warmth = 0.2, contrast = 8 }) base

                    shell =
                        ShellPalette.derive { themeId = "ocean", base = base, tokens = generated, highContrast = False }
                in
                Expect.all
                    [ \s -> Expect.equal True (ShellPalette.isLight s)
                    , \s -> Expect.equal [] (ShellPalette.contrastFailures False s)
                    ]
                    shell
        , test "generated palettes (both schemes, many seeds) come out AA and HC-clean" <|
            \_ ->
                Expect.equal []
                    (List.concatMap
                        (\n ->
                            List.concatMap
                                (\scheme ->
                                    let
                                        seed =
                                            Theme.randomSeed n

                                        tokens =
                                            Theme.generatePalette { seed | scheme = scheme }

                                        derived hc =
                                            ShellPalette.derive { themeId = "custom:x", base = Dict.empty, tokens = tokens, highContrast = hc }
                                    in
                                    List.map (\f -> String.fromInt n ++ scheme ++ ": " ++ f)
                                        (ShellPalette.contrastFailures False (derived False) ++ ShellPalette.contrastFailures True (derived True))
                                )
                                [ "dark", "light" ]
                        )
                        (List.range 1 24)
                    )
        , test "hostile or unresolvable tokens fall back and still pass" <|
            \_ ->
                let
                    tokens =
                        Dict.fromList
                            [ ( "--ink", "color-mix(in oklab, var(--paper) 50%, transparent)" )
                            , ( "--paper", "#101010" )
                            , ( "--paper-dim", "var(--missing)" )
                            , ( "--lapis", "url(x)" )
                            , ( "--stone", "var(--stone)" )
                            ]

                    derived hc =
                        ShellPalette.derive { themeId = "custom:x", base = Dict.empty, tokens = tokens, highContrast = hc }
                in
                Expect.all
                    [ \_ -> Expect.equal house.bg (derived False).bg
                    , \_ -> Expect.equal [] (ShellPalette.contrastFailures False (derived False))
                    , \_ -> Expect.equal [] (ShellPalette.contrastFailures True (derived True))
                    ]
                    ()
        , test "an empty token map derives a clean house-like shell" <|
            \_ ->
                let
                    shell =
                        ShellPalette.derive { themeId = "custom:x", base = Dict.empty, tokens = Dict.empty, highContrast = False }
                in
                Expect.all
                    [ \s -> Expect.equal house.bg s.bg
                    , \s -> Expect.equal [] (ShellPalette.contrastFailures False s)
                    ]
                    shell
        , test "the commit is 24 prefixed #rrggbb pairs (base + high contrast)" <|
            \_ ->
                let
                    pairs =
                        ShellPalette.commitTokens { themeId = "pearl", base = ThemeTokens.tokensFor "pearl", tokens = ThemeTokens.tokensFor "pearl" }
                in
                Expect.all
                    [ \p -> Expect.equal 24 (List.length p)
                    , \p -> Expect.equal True (List.all (\( _, v ) -> hexOnly v) p)
                    , \p ->
                        Expect.equal
                            (List.map (\s -> "--onyx-theme-" ++ s) ShellPalette.slotNames ++ List.map (\s -> "--onyx-theme-hc-" ++ s) ShellPalette.slotNames)
                            (List.map Tuple.first p)
                    ]
                    pairs
        , test "only Ocean carries anchors" <|
            \_ ->
                Expect.equal [ "ocean" ]
                    (List.filter (\id -> not (Dict.isEmpty (ShellPalette.anchorsFor id))) ThemeTokens.themeIds)
        ]
