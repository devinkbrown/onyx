module ThemeTest exposing (suite)

{-| Generative theme factory: hex parsing, WCAG reference ratios,
OKLCH round-trips, the banned-hue guard, full-palette generation with
an all-pass AA audit, transforms, and the seeded PRNG. Oracles
`src/theme/paletteFactory.ts` and `src/theme/contrast.ts`.
-}

import Dict
import Expect
import Test exposing (Test, describe, test)
import Theme exposing (..)


suite : Test
suite =
    describe "Theme"
        [ describe "hex and rgb"
            [ test "parses short long and alpha hex" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just { r = 255, g = 255, b = 255 }) (parseHex "#fff")
                        , \_ -> Expect.equal (Just { r = 255, g = 0, b = 0 }) (parseHex "#ff000080")
                        , \_ -> Expect.equal (Just { r = 0, g = 0, b = 0 }) (parseHex "#000000")
                        , \_ -> Expect.equal Nothing (parseHex "red")
                        , \_ -> Expect.equal Nothing (parseHex "#12")
                        ]
                        ()
            , test "rgbToHex pads channels" <|
                \_ ->
                    Expect.equal "#0a141e" (rgbToHex { r = 10, g = 20, b = 30 })
            ]
        , describe "WCAG contrast"
            [ test "black on white is 21, same colour is 1" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal 21
                                (contrastRatio { r = 0, g = 0, b = 0 } { r = 255, g = 255, b = 255 })
                        , \_ ->
                            Expect.equal 1
                                (contrastRatio { r = 10, g = 20, b = 30 } { r = 10, g = 20, b = 30 })
                        ]
                        ()
            , test "reference grey pair matches the WCAG example" <|
                \_ ->
                    -- #777777 on #ffffff is the canonical ~4.48 example.
                    let
                        ratio =
                            contrastRatio { r = 119, g = 119, b = 119 } { r = 255, g = 255, b = 255 }
                    in
                    Expect.equal True (ratio > 4.47 && ratio < 4.49)
            ]
        , describe "OKLCH conversion"
            [ test "white is L≈1 chroma≈0, black is L≈0" <|
                \_ ->
                    let
                        white =
                            rgbToOklch { r = 255, g = 255, b = 255 }

                        black =
                            rgbToOklch { r = 0, g = 0, b = 0 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (abs (white.l - 1) < 0.001 && white.c < 0.0001)
                        , \_ -> Expect.equal True (black.l < 0.0001 && black.c < 0.0001)
                        ]
                        ()
            , test "extremes format exactly" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "#000000" (oklchToHex { l = 0, c = 0, h = 0 })
                        , \_ -> Expect.equal "#ffffff" (oklchToHex { l = 1, c = 0, h = 0 })
                        ]
                        ()
            , test "in-gamut colours round-trip through hex" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "#46c08a") (Maybe.map oklchToHex (hexToOklch "#46c08a"))
                        , \_ -> Expect.equal (Just "#0b0e12") (Maybe.map oklchToHex (hexToOklch "#0b0e12"))
                        , \_ -> Expect.equal (Just "#e8e6e1") (Maybe.map oklchToHex (hexToOklch "#e8e6e1"))
                        ]
                        ()
            ]
        , describe "banned-hue guard"
            [ test "snaps the violet arc to the nearer edge" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 254 (avoidBannedHue 258)
                        , \_ -> Expect.equal 346 (avoidBannedHue 342)
                        , \_ -> Expect.equal 346 (avoidBannedHue 300)
                        , \_ -> Expect.equal 200 (avoidBannedHue 200)
                        , \_ -> Expect.equal 232 (avoidBannedHue 232)
                        ]
                        ()
            ]
        , describe "palette generation"
            [ test "default seed yields 24 tokens with parseable grounds" <|
                \_ ->
                    let
                        tokens =
                            generatePalette defaultSeed
                    in
                    Expect.all
                        [ \_ -> Expect.equal 24 (Dict.size tokens)
                        , \_ ->
                            Expect.equal True
                                (List.all
                                    (\key ->
                                        Dict.get key tokens
                                            |> Maybe.andThen parseHex
                                            |> (/=) Nothing
                                    )
                                    [ "--ink", "--stone", "--lapis", "--gold", "--shu", "--paper", "--ok", "--warn" ]
                                )
                        , \_ -> Expect.equal (Just "var(--shu)") (Dict.get "--danger" tokens)
                        ]
                        ()
            , test "generated dark palette passes every AA pair" <|
                \_ ->
                    Expect.equal True
                        (List.all .pass (auditPalette (generatePalette defaultSeed)))
            , test "generated light palette passes every AA pair" <|
                \_ ->
                    Expect.equal True
                        (List.all .pass
                            (auditPalette
                                (generatePalette
                                    { defaultSeed
                                        | scheme = "light"
                                        , primaryHue = 150
                                        , accentHue = 40
                                    }
                                )
                            )
                        )
            , test "seed hues survive a banned primary" <|
                \_ ->
                    let
                        tokens =
                            generatePalette { defaultSeed | primaryHue = 300, accentHue = 300 }
                    in
                    Expect.equal True
                        (List.all .pass (auditPalette tokens))
            ]
        , describe "transforms"
            [ test "identity transform keeps hex tokens" <|
                \_ ->
                    let
                        tokens =
                            generatePalette defaultSeed

                        same =
                            adjustPalette tokens { hueShift = 0, saturation = Just 1, warmth = 0, contrast = 0 } "dark"
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Dict.get "--danger" tokens) (Dict.get "--danger" same)
                        , \_ -> Expect.equal (Dict.get "--seam" tokens) (Dict.get "--seam" same)
                        , \_ -> Expect.equal (Dict.get "--lapis" tokens) (Dict.get "--lapis" same)
                        ]
                        ()
            , test "hue rotation moves the accent" <|
                \_ ->
                    let
                        tokens =
                            generatePalette defaultSeed

                        rotated =
                            adjustPalette tokens { hueShift = 120, saturation = Nothing, warmth = 0, contrast = 0 } "dark"
                    in
                    Expect.equal False
                        (Dict.get "--lapis" tokens == Dict.get "--lapis" rotated)
            , test "seed round-trips approximately from generated tokens" <|
                \_ ->
                    let
                        recovered =
                            seedFromTokens (generatePalette defaultSeed) "dark"

                        lapisHue =
                            hexToOklch (Maybe.withDefault "#000000" (Dict.get "--lapis" (generatePalette defaultSeed)))
                                |> Maybe.map .h
                                |> Maybe.withDefault 0
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (abs (recovered.primaryHue - lapisHue) < 5)
                        , \_ -> Expect.equal True (recovered.depth >= 0 && recovered.depth <= 1)
                        ]
                        ()
            ]
        , describe "seeded random"
            [ test "same integer reproduces the seed" <|
                \_ ->
                    Expect.equal (randomSeed 42) (randomSeed 42)
            , test "random palettes stay in the hue guard and pass AA" <|
                \_ ->
                    let
                        seeds =
                            List.map randomSeed (List.range 1 5)

                        palettes =
                            List.map generatePalette seeds
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal True
                                (List.all
                                    (\seed ->
                                        let
                                            h =
                                                if seed.primaryHue < 258 then
                                                    seed.primaryHue

                                                else
                                                    seed.primaryHue - 360
                                        in
                                        h < 258 || h > 342
                                    )
                                    seeds
                                )
                        , \_ ->
                            Expect.equal True
                                (List.all (List.all .pass << auditPalette) palettes)
                        ]
                        ()
            ]
        ]
