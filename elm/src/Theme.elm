module Theme exposing
    ( Oklch
    , PaletteSeed
    , PaletteTransform
    , TokenMap
    , adjustPalette
    , auditPalette
    , avoidBannedHue
    , contrastRatio
    , defaultSeed
    , enforceAA
    , generatePalette
    , hexToOklch
    , oklchToHex
    , oklchToRgb
    , Rgb
    , parseHex
    , randomSeed
    , relativeLuminance
    , rgbToHex
    , rgbToOklch
    , seedFromTokens
    )

{-| Generative theme factory — Elm port of `src/theme/paletteFactory.ts`
(seed → OKLCH token map) and `src/theme/contrast.ts` (WCAG math).

From one hue plus a few knobs the factory derives grounds, accent
triads, text, and seams laid out in OKLCH so lightness is perceptually
even and AA contrast holds by construction (plus `enforceAA` repair).

Identity constraint preserved: the indigo→violet→purple→magenta arc
(~258°–342°) is snapped away from, so generated themes never drift
into the banned band.

Float note: every operation here is plain Float64 arithmetic, so
results match the TypeScript oracle bit-for-bit except where noted
(`randomSeed` takes an explicit integer — entropy arrives via flags,
never `Date.now()` — and `hexToOklch` rounds through 8-bit channels
exactly like the oracle).

-}

import Bitwise
import Dict exposing (Dict)


type alias Rgb =
    { r : Int, g : Int, b : Int }


type alias Oklch =
    { l : Float
    , c : Float
    , h : Float
    }


type alias TokenMap =
    Dict String String


type alias PaletteSeed =
    { scheme : String
    , primaryHue : Float
    , accentHue : Float
    , depth : Float
    , vibrancy : Float
    , warmth : Float
    , contrast : Float
    }


type alias PaletteTransform =
    { hueShift : Float
    , saturation : Maybe Float
    , warmth : Float
    , contrast : Float
    }


type alias AuditRow =
    { fg : String
    , bg : String
    , ratio : Float
    , min : Float
    , pass : Bool
    }


defaultSeed : PaletteSeed
defaultSeed =
    { scheme = "dark"
    , primaryHue = 232
    , accentHue = 205
    , depth = 0.72
    , vibrancy = 0.6
    , warmth = 0.05
    , contrast = 8
    }


bannedHueMin : Float
bannedHueMin =
    258


bannedHueMax : Float
bannedHueMax =
    342


clamp : Float -> Float -> Float -> Float
clamp v lo hi =
    max lo (min hi v)


clampInt : Int -> Int -> Int -> Int
clampInt v lo hi =
    max lo (min hi v)



-- ── Hex / RGB ────────────────────────────────────────────────────────


hexDigitValue : Char -> Maybe Int
hexDigitValue c =
    if c >= '0' && c <= '9' then
        Just (Char.toCode c - Char.toCode '0')

    else if c >= 'a' && c <= 'f' then
        Just (Char.toCode c - Char.toCode 'a' + 10)

    else if c >= 'A' && c <= 'F' then
        Just (Char.toCode c - Char.toCode 'A' + 10)

    else
        Nothing


hexPair : Char -> Char -> Maybe Int
hexPair hi lo =
    case ( hexDigitValue hi, hexDigitValue lo ) of
        ( Just h, Just l ) ->
            Just (h * 16 + l)

        _ ->
            Nothing


{-| Parse `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa` (alpha ignored).
-}
parseHex : String -> Maybe Rgb
parseHex input =
    let
        hex =
            String.toList (String.trim input)
    in
    case hex of
        '#' :: rest ->
            case rest of
                [ a, b, c ] ->
                    expandShort [ a, b, c ]

                [ a, b, c, _ ] ->
                    expandShort [ a, b, c ]

                [ a, b, c, d, e, f ] ->
                    combineHex [ a, b, c, d, e, f ]

                [ a, b, c, d, e, f, _, _ ] ->
                    combineHex [ a, b, c, d, e, f ]

                _ ->
                    Nothing

        _ ->
            Nothing


expandShort : List Char -> Maybe Rgb
expandShort chars =
    case chars of
        [ a, b, c ] ->
            combineHex [ a, a, b, b, c, c ]

        _ ->
            Nothing


combineHex : List Char -> Maybe Rgb
combineHex chars =
    case chars of
        [ a, b, c, d, e, f ] ->
            case ( hexPair a b, hexPair c d, hexPair e f ) of
                ( Just r, Just g, Just bl ) ->
                    Just { r = r, g = g, b = bl }

                _ ->
                    Nothing

        _ ->
            Nothing


hexDigit : Int -> Char
hexDigit n =
    case n of
        0 ->
            '0'

        1 ->
            '1'

        2 ->
            '2'

        3 ->
            '3'

        4 ->
            '4'

        5 ->
            '5'

        6 ->
            '6'

        7 ->
            '7'

        8 ->
            '8'

        9 ->
            '9'

        10 ->
            'a'

        11 ->
            'b'

        12 ->
            'c'

        13 ->
            'd'

        14 ->
            'e'

        _ ->
            'f'


rgbToHex : Rgb -> String
rgbToHex rgb =
    let
        byte n =
            let
                v =
                    clampInt n 0 255
            in
            String.fromChar (hexDigit (v // 16)) ++ String.fromChar (hexDigit (modBy 16 v))
    in
    "#" ++ byte rgb.r ++ byte rgb.g ++ byte rgb.b



-- ── WCAG contrast ────────────────────────────────────────────────────


relativeLuminance : Rgb -> Float
relativeLuminance rgb =
    let
        lin c =
            let
                s =
                    toFloat c / 255
            in
            if s <= 0.03928 then
                s / 12.92

            else
                ((s + 0.055) / 1.055) ^ 2.4
    in
    0.2126 * lin rgb.r + 0.7152 * lin rgb.g + 0.0722 * lin rgb.b


contrastRatio : Rgb -> Rgb -> Float
contrastRatio a b =
    let
        la =
            relativeLuminance a

        lb =
            relativeLuminance b

        lighter =
            max la lb

        darker =
            min la lb
    in
    (lighter + 0.05) / (darker + 0.05)



-- ── sRGB ⇄ OKLCH (Björn Ottosson's oklab) ────────────────────────────


srgbToLinear : Int -> Float
srgbToLinear c =
    let
        s =
            toFloat c / 255
    in
    if s <= 0.04045 then
        s / 12.92

    else
        ((s + 0.055) / 1.055) ^ 2.4


linearToSrgb : Float -> Int
linearToSrgb c =
    let
        s =
            if c <= 0.0031308 then
                c * 12.92

            else
                1.055 * (c ^ (1 / 2.4)) - 0.055
    in
    round (clamp s 0 1 * 255)


linearToOklab : Float -> Float -> Float -> { l : Float, a : Float, b : Float }
linearToOklab r g b =
    let
        l =
            0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b

        m =
            0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b

        s =
            0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b

        l_ =
            l ^ (1 / 3)

        m_ =
            m ^ (1 / 3)

        s_ =
            s ^ (1 / 3)
    in
    { l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
    , a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
    , b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
    }


{-| OKLab → linear sRGB (may be out of [0,1]). -}
oklabToLinear : Float -> Float -> Float -> { r : Float, g : Float, b : Float }
oklabToLinear =
    oklabLinear


rgbToOklch : Rgb -> Oklch
rgbToOklch rgb =
    let
        lab =
            linearToOklab (srgbToLinear rgb.r) (srgbToLinear rgb.g) (srgbToLinear rgb.b)

        c =
            sqrt (lab.a * lab.a + lab.b * lab.b)

        h =
            atan2 lab.b lab.a * 180 / pi
    in
    { l = lab.l, c = c, h = if h < 0 then h + 360 else h }


inGamut : Float -> Float -> Float -> Bool
inGamut l a b =
    let
        e =
            0.0001

        lin =
            oklabLinear l a b
    in
    lin.r >= -e && lin.r <= 1 + e && lin.g >= -e && lin.g <= 1 + e && lin.b >= -e && lin.b <= 1 + e


oklabLinear : Float -> Float -> Float -> { r : Float, g : Float, b : Float }
oklabLinear l a b =
    let
        l_ =
            l + 0.3963377774 * a + 0.2158037573 * b

        m_ =
            l - 0.1055613458 * a - 0.0638541728 * b

        s_ =
            l - 0.0894841775 * a - 1.291485548 * b

        cube x =
            x * x * x
    in
    { r = 4.0767416621 * cube l_ - 3.3077115913 * cube m_ + 0.2309699292 * cube s_
    , g = -1.2684380046 * cube l_ + 2.6097574011 * cube m_ - 0.3413193965 * cube s_
    , b = -0.0041960863 * cube l_ - 0.7034186147 * cube m_ + 1.707614701 * cube s_
    }


{-| OKLCH → sRGB, reducing chroma until the colour fits the gamut
(hue + lightness preserved).
-}
oklchToRgb : Oklch -> Rgb
oklchToRgb color =
    let
        hr =
            color.h * pi / 180

        lo =
            clamp color.l 0 1

        fit c =
            let
                lin =
                    oklabLinear lo (c * cos hr) (c * sin hr)
            in
            { r = linearToSrgb lin.r, g = linearToSrgb lin.g, b = linearToSrgb lin.b }
    in
    fit (searchChroma lo hr (max 0 color.c))


searchChroma : Float -> Float -> Float -> Float
searchChroma l hr c =
    let
        go lo hi i =
            if i <= 0 then
                lo

            else
                let
                    mid =
                        (lo + hi) / 2
                in
                if inGamut l (mid * cos hr) (mid * sin hr) then
                    go mid hi (i - 1)

                else
                    go lo mid (i - 1)
    in
    if inGamut l (c * cos hr) (c * sin hr) then
        c

    else
        go 0 c 24


oklchToHex : Oklch -> String
oklchToHex color =
    rgbToHex (oklchToRgb color)


hexToOklch : String -> Maybe Oklch
hexToOklch hex =
    Maybe.map rgbToOklch (parseHex hex)



-- ── Hue guard ────────────────────────────────────────────────────────


wrapHue : Float -> Float
wrapHue h =
    let
        m =
            h - 360 * toFloat (floor (h / 360))
    in
    if m < 0 then
        m + 360

    else
        m


avoidBannedHue : Float -> Float
avoidBannedHue h =
    let
        hue =
            wrapHue h
    in
    if hue < bannedHueMin || hue > bannedHueMax then
        hue

    else if hue - bannedHueMin < bannedHueMax - hue then
        bannedHueMin - 4

    else
        bannedHueMax + 4



-- ── Generation ───────────────────────────────────────────────────────


sanitizeSeed : PaletteSeed -> PaletteSeed
sanitizeSeed seed =
    { scheme =
        if seed.scheme == "light" then
            "light"

        else
            "dark"
    , primaryHue = avoidBannedHue seed.primaryHue
    , accentHue = avoidBannedHue seed.accentHue
    , depth = clamp seed.depth 0 1
    , vibrancy = clamp seed.vibrancy 0 1
    , warmth = clamp seed.warmth -1 1
    , contrast = clamp seed.contrast 4.5 21
    }


generatePalette : PaletteSeed -> TokenMap
generatePalette seedInput =
    let
        seed =
            sanitizeSeed seedInput

        dark =
            seed.scheme == "dark"

        pHue =
            seed.primaryHue

        aHue =
            seed.accentHue

        warmHueShift =
            seed.warmth * 12

        groundHue =
            avoidBannedHue (pHue + warmHueShift)

        groundChroma =
            0.014 + 0.02 * seed.vibrancy

        inkL =
            if dark then
                0.13 - 0.05 * seed.depth

            else
                0.975 - 0.03 * seed.depth

        step =
            if dark then
                0.028 + 0.02 * (1 - seed.depth)

            else
                -(0.02 + 0.014 * (1 - seed.depth))

        ground i chromaMul =
            oklchToHex { l = inkL + step * i, c = groundChroma * chromaMul, h = groundHue }

        pChroma =
            0.09 + 0.15 * seed.vibrancy

        aChroma =
            0.075 + 0.13 * seed.vibrancy

        primary l cMul =
            oklchToHex { l = l, c = pChroma * cMul, h = pHue }

        accent l cMul =
            oklchToHex { l = l, c = aChroma * cMul, h = aHue }

        inkGround =
            ground 0 1

        inkRgb =
            Maybe.withDefault { r = 0, g = 0, b = 0 } (parseHex inkGround)

        textHue =
            avoidBannedHue (pHue + warmHueShift * 1.5)

        textChroma =
            0.012 + 0.01 * seed.vibrancy

        paperL =
            solveTextLightness inkRgb textHue textChroma seed.contrast dark

        shuHue =
            avoidBannedHue (28 + seed.warmth * 6)

        paper l =
            oklchToHex { l = l, c = textChroma, h = textHue }

        tokens =
            Dict.fromList
                [ ( "--ink", inkGround )
                , ( "--ink-2", ground 0.55 1 )
                , ( "--stone", ground 2 1 )
                , ( "--stone-2", ground 3.4 1 )
                , ( "--stone-3", ground 4.8 1 )
                , ( "--stone-line", ground 6 1.4 )
                , ( "--lapis", primary (if dark then 0.62 else 0.5) 1 )
                , ( "--lapis-bright", primary (if dark then 0.78 else 0.62) 0.9 )
                , ( "--lapis-deep", primary (if dark then 0.42 else 0.36) 0.85 )
                , ( "--gold", accent (if dark then 0.7 else 0.52) 1 )
                , ( "--gold-bright", accent (if dark then 0.83 else 0.62) 0.9 )
                , ( "--gold-deep", accent (if dark then 0.5 else 0.4) 0.85 )
                , ( "--shu", oklchToHex { l = if dark then 0.64 else 0.55, c = 0.19, h = shuHue } )
                , ( "--shu-bright", oklchToHex { l = if dark then 0.74 else 0.62, c = 0.2, h = shuHue } )
                , ( "--paper", paper paperL )
                , ( "--paper-dim", paper (if dark then paperL - 0.22 else paperL + 0.2) )
                , ( "--paper-mute", oklchToHex { l = if dark then paperL - 0.4 else paperL + 0.38, c = textChroma * 1.4, h = textHue } )
                , ( "--ok", oklchToHex { l = if dark then 0.75 else 0.58, c = 0.13, h = 158 } )
                , ( "--warn", oklchToHex { l = if dark then 0.86 else 0.62, c = 0.09, h = 92 } )
                , ( "--danger", "var(--shu)" )
                , ( "--seam", "color-mix(in oklab, var(--lapis) 38%, transparent)" )
                , ( "--seam-faint", "color-mix(in oklab, var(--lapis) 15%, transparent)" )
                , ( "--line", "color-mix(in oklab, var(--paper) 14%, transparent)" )
                , ( "--line-faint", "color-mix(in oklab, var(--paper) 7%, transparent)" )
                ]
    in
    enforceAA tokens seed.scheme


solveTextLightness : Rgb -> Float -> Float -> Float -> Bool -> Float
solveTextLightness bg hue chroma target dark =
    let
        start =
            if dark then 0.9 else 0.28

        dir =
            if dark then 0.01 else -0.01

        go l i =
            if i <= 0 then
                l

            else if contrastRatio (oklchToRgb { l = l, c = chroma, h = hue }) bg >= target then
                l

            else
                go (clamp (l + dir) 0 1) (i - 1)
    in
    go start 30



-- ── AA enforcement + audit ───────────────────────────────────────────


aaPairs : List ( String, String, Float )
aaPairs =
    [ ( "--paper", "--ink", 4.5 )
    , ( "--paper", "--stone", 4.5 )
    , ( "--paper", "--stone-2", 4.5 )
    , ( "--paper-dim", "--ink", 4.5 )
    , ( "--paper-mute", "--ink", 3 )
    , ( "--lapis-bright", "--ink", 4.5 )
    , ( "--gold-bright", "--ink", 3 )
    , ( "--ok", "--ink", 3 )
    , ( "--shu-bright", "--ink", 3 )
    ]


enforceAA : TokenMap -> String -> TokenMap
enforceAA tokens scheme =
    let
        dark =
            scheme == "dark"

        dir =
            if dark then 0.015 else -0.015

        repair out ( fg, bg, min ) =
            case ( Dict.get bg out, Dict.get fg out ) of
                ( Just bgHex, Just fgHex ) ->
                    case ( parseHex bgHex, hexToOklch fgHex ) of
                        ( Just bgRgb, Just fgOk ) ->
                            let
                                go l i =
                                    if i <= 0 then
                                        l

                                    else if contrastRatio (oklchToRgb { l = l, c = fgOk.c, h = fgOk.h }) bgRgb >= min then
                                        l

                                    else
                                        go (clamp (l + dir) 0 1) (i - 1)

                                final =
                                    go fgOk.l 40
                            in
                            Dict.insert fg (oklchToHex { l = final, c = fgOk.c, h = fgOk.h }) out

                        _ ->
                            out

                _ ->
                    out
    in
    List.foldl (\pair acc -> repair acc pair) tokens aaPairs


auditPalette : TokenMap -> List AuditRow
auditPalette tokens =
    List.map
        (\( fg, bg, min ) ->
            case ( Dict.get fg tokens |> Maybe.andThen parseHex, Dict.get bg tokens |> Maybe.andThen parseHex ) of
                ( Just f, Just b ) ->
                    let
                        ratio =
                            toFloat (round (contrastRatio f b * 100)) / 100
                    in
                    { fg = fg, bg = bg, ratio = ratio, min = min, pass = ratio >= min }

                _ ->
                    { fg = fg, bg = bg, ratio = 0, min = min, pass = False }
        )
        aaPairs



-- ── Global transforms ──────────────────────────────────────────────


textTokens : List String
textTokens =
    [ "--paper", "--paper-dim", "--paper-mute" ]


lerpHue : Float -> Float -> Float -> Float
lerpHue a b t =
    let
        diff =
            modFloat (b - a + 540) 360 - 180
    in
    modFloat (a + diff * t) 360


modFloat : Float -> Float -> Float
modFloat x m =
    let
        q =
            x - m * toFloat (floor (x / m))
    in
    if q < 0 then
        q + m

    else
        q


adjustPalette : TokenMap -> PaletteTransform -> String -> TokenMap
adjustPalette tokens t scheme =
    let
        dark =
            scheme == "dark"

        adjust key value =
            case hexToOklch value of
                Nothing ->
                    value

                Just ok ->
                    let
                        shifted =
                            if t.hueShift /= 0 then
                                modFloat (ok.h + t.hueShift) 360

                            else
                                ok.h

                        warmed =
                            if t.warmth /= 0 then
                                lerpHue shifted (if t.warmth > 0 then 40 else 250) (abs t.warmth * 0.25)

                            else
                                shifted

                        saturated =
                            case t.saturation of
                                Nothing ->
                                    ok.c

                                Just s ->
                                    ok.c * s

                        lightened =
                            if t.contrast /= 0 && List.member key textTokens then
                                clamp (ok.l + t.contrast * (if dark then 0.12 else -0.12)) 0 1

                            else
                                ok.l
                    in
                    oklchToHex { l = lightened, c = saturated, h = avoidBannedHue warmed }
    in
    Dict.map adjust tokens



-- ── Randomisation ────────────────────────────────────────────────────


{-| 32-bit multiply with C semantics (low 32 bits of the product),
exact in Float64 via 16-bit halves.
-}
imul32 : Int -> Int -> Int
imul32 a b =
    let
        mask =
            65535

        alo =
            Bitwise.and a mask

        ahi =
            Bitwise.shiftRightZfBy 16 a

        blo =
            Bitwise.and b mask

        bhi =
            Bitwise.shiftRightZfBy 16 b
    in
    Bitwise.or (Bitwise.shiftLeftBy 16 (ahi * blo + alo * bhi) + alo * blo) 0


add32 : Int -> Int -> Int
add32 x y =
    Bitwise.or (x + y) 0


{-| Deterministic PRNG (mulberry32): same integer seed reproduces the
palette. `next seed` returns the new state plus a Float in [0,1).
-}
mulberry32 : Int -> ( Int, Float )
mulberry32 seed =
    let
        a =
            add32 seed 0x6D2B79F5

        t0 =
            a

        t1 =
            imul32 (Bitwise.xor t0 (Bitwise.shiftRightZfBy 15 t0)) (Bitwise.or t0 1)

        t2 =
            Bitwise.xor t1 (add32 t1 (imul32 (Bitwise.xor t1 (Bitwise.shiftRightZfBy 7 t1)) (Bitwise.or t1 61)))

        t3 =
            Bitwise.xor t2 (Bitwise.shiftRightZfBy 14 t2)
    in
    ( a, toFloat (Bitwise.shiftRightZfBy 0 t3) / 4294967296 )


randomSeed : Int -> PaletteSeed
randomSeed rngSeed =
    let
        ( s1, r1 ) =
            mulberry32 rngSeed

        ( s2, r2 ) =
            mulberry32 s1

        ( s3, r3 ) =
            mulberry32 s2

        ( s4, r4 ) =
            mulberry32 s3

        ( s5, r5 ) =
            mulberry32 s4

        ( s6, r6 ) =
            mulberry32 s5

        ( s7, r7 ) =
            mulberry32 s6

        ( s8, r8 ) =
            mulberry32 s7

        ( _, r9 ) =
            mulberry32 s8

        primaryHue =
            avoidBannedHue (toFloat (floor (r1 * 360)))

        offset =
            if r2 < 0.5 then
                26 + r3 * 30

            else
                150 + r3 * 60

        accentHue =
            avoidBannedHue (primaryHue + (if r4 < 0.5 then offset else -offset))
    in
    { scheme =
        if r5 < 0.82 then
            "dark"

        else
            "light"
    , primaryHue = primaryHue
    , accentHue = accentHue
    , depth = 0.5 + r6 * 0.45
    , vibrancy = 0.4 + r7 * 0.55
    , warmth = (r8 - 0.5) * 0.8
    , contrast = 7 + r9 * 3
    }


seedFromTokens : TokenMap -> String -> PaletteSeed
seedFromTokens tokens scheme =
    let
        dark =
            scheme == "dark"

        primary =
            Maybe.withDefault { l = 0.6, c = 0.16, h = defaultSeed.primaryHue }
                (Dict.get "--lapis" tokens |> Maybe.andThen hexToOklch)

        accent =
            Maybe.withDefault { l = 0.6, c = 0.14, h = defaultSeed.accentHue }
                (Dict.get "--gold" tokens |> Maybe.andThen hexToOklch)

        ink =
            Maybe.withDefault { l = 0.1, c = 0.01, h = primary.h }
                (Dict.get "--ink" tokens |> Maybe.andThen hexToOklch)
    in
    { scheme = scheme
    , primaryHue = primary.h
    , accentHue = accent.h
    , depth =
        clamp
            (if dark then
                (0.13 - ink.l) / 0.05

             else
                (0.975 - ink.l) / 0.03
            )
            0
            1
    , vibrancy = clamp ((primary.c - 0.09) / 0.15) 0 1
    , warmth = 0
    , contrast = 8
    }
