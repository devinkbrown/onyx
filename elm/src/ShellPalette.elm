module ShellPalette exposing
    ( Shell
    , Slot
    , anchorsFor
    , commitTokens
    , contrastFailures
    , derive
    , isLight
    , slotNames
    , toPairs
    )

{-| v3/gap-appearance — the ONE place the shell's semantic `--onyx-*`
palette is derived from the active theme.

The shell paints with the `--onyx-*` colours; themes (built-in, custom,
and Theme Studio sessions) write the Solid palette (`--ink`, `--stone*`,
`--paper*`, `--lapis`, …). This module maps one onto the other and
enforces contrast on the way:

  - bg ← `--ink`, panel ← `--stone`, panel-2 ← `--stone-2`,
    line ← `--stone-line` (surfaces step away from the ground when a
    token is missing or unresolvable);
  - text ← `--paper`, dim ← `--paper-dim`, faint ← `--paper-mute`;
  - accent ← `--lapis`, accent-ink ← `--on-accent` / ground / text /
    black / white (the first that reads AA on the accent);
  - warn ← `--warn`, bad ← `--danger` (→ `--shu`), success ← `--ok`.

Every foreground is then nudged in OKLCH lightness (hue and chroma
kept, gamut-fit) until it clears its target against the worst ground
it sits on — AA for the base set, one rung up for the high-contrast
set. The output never depends on the DOM, so it unit-tests directly
and produces only `#rrggbb` (never a CSS-injection sink).

Ocean, the default look, carries explicit anchors equal to the v3
house palette (`app.css :root`), so the default stays pixel-identical;
an anchor yields to derivation as soon as the user edits one of the
slot's source tokens (Theme Studio or a saved custom theme).

`commitTokens` returns the inline pairs `appearanceApply` writes:
`--onyx-theme-<slot>` (base) and `--onyx-theme-hc-<slot>` (high
contrast). `css/gap-appearance.css` picks one set per state (the
Raise-contrast switch or `prefers-contrast: more`), with the house
values as first-paint fallbacks.

-}

import Dict exposing (Dict)
import Studio
import Theme


{-| One resolved shell palette (every value `#rrggbb`). -}
type alias Shell =
    { bg : String
    , panel : String
    , panel2 : String
    , line : String
    , text : String
    , dim : String
    , faint : String
    , accent : String
    , accentInk : String
    , warn : String
    , bad : String
    , success : String
    }


type alias Slot =
    String


{-| Slot names in commit order (CSS suffixes). -}
slotNames : List Slot
slotNames =
    [ "bg", "panel", "panel-2", "line", "text", "dim", "faint", "accent", "accent-ink", "warn", "bad", "success" ]


{-| The palette token each slot is derived from: an anchor holds only
while this token still equals the base theme's own value (every value,
anchored or not, then passes the same contrast guard against the
grounds actually rendered). -}
slotSources : Slot -> List String
slotSources slot =
    case slot of
        "bg" ->
            [ "--ink" ]

        "panel" ->
            [ "--stone" ]

        "panel-2" ->
            [ "--stone-2" ]

        "line" ->
            [ "--stone-line" ]

        "text" ->
            [ "--paper" ]

        "dim" ->
            [ "--paper-dim" ]

        "faint" ->
            [ "--paper-mute" ]

        "accent" ->
            [ "--lapis" ]

        "accent-ink" ->
            [ "--on-accent", "--lapis" ]

        "warn" ->
            [ "--warn" ]

        "bad" ->
            [ "--danger", "--shu" ]

        "success" ->
            [ "--ok" ]

        _ ->
            []


{-| Explicit slot values for a built-in theme. Ocean (the default look)
is the v3 house cut — `app.css :root` — so a fresh install renders
exactly as before; every other theme derives from its palette.
-}
anchorsFor : String -> Dict Slot String
anchorsFor themeId =
    case themeId of
        "ocean" ->
            Dict.fromList
                [ ( "bg", "#0b0e12" )
                , ( "panel", "#12161c" )
                , ( "panel-2", "#181e27" )
                , ( "line", "#232b36" )
                , ( "text", "#e8e6e1" )
                , ( "dim", "#9aa3ad" )
                , ( "faint", "#606973" )
                , ( "accent", "#46c08a" )
                , ( "accent-ink", "#06281a" )
                , ( "warn", "#d9a13b" )
                , ( "bad", "#e5484d" )
                , ( "success", "#46c08a" )
                ]

        _ ->
            Dict.empty



-- ── Targets ──────────────────────────────────────────────────────────


type alias Targets =
    { text : Float
    , dim : Float
    , faint : Float
    , accent : Float
    , accentInk : Float
    , status : Float
    , line : Float
    }


{-| Base set: WCAG AA for text (4.5), 3:1 for metadata (`faint`, the
house budget — on every surface it can sit on, panel-2 included), no
floor on the decorative seam. -}
baseTargets : Targets
baseTargets =
    { text = 4.5, dim = 4.5, faint = 3, accent = 4.5, accentInk = 4.5, status = 4.5, line = 1 }


{-| High-contrast set: one WCAG rung up (AAA 7 for text, secondary text
and the accent; AA for metadata and status) and seams that read as
real boundaries (3:1, WCAG 1.4.11). -}
hcTargets : Targets
hcTargets =
    { text = 7, dim = 7, faint = 4.5, accent = 7, accentInk = 4.5, status = 4.5, line = 3 }


targetsFor : Bool -> Targets
targetsFor highContrast =
    if highContrast then
        hcTargets

    else
        baseTargets



-- ── Derivation ───────────────────────────────────────────────────────


{-| Derive the shell for a resolved token map.

  - `themeId` picks the anchors (custom themes pass their base id);
  - `base` is that built-in theme's own map — a slot keeps its anchor
    only while every source token still equals `base`;
  - `tokens` is the map as rendered (base + saved + session overrides);
  - `highContrast` selects the stricter targets.

-}
derive : { themeId : String, base : Dict String String, tokens : Dict String String, highContrast : Bool } -> Shell
derive input =
    let
        targets =
            targetsFor input.highContrast

        anchors =
            anchorsFor input.themeId

        untouched slot =
            List.all (\name -> Dict.get name input.tokens == Dict.get name input.base) (slotSources slot)

        anchor slot =
            if untouched slot then
                Dict.get slot anchors |> Maybe.andThen Theme.parseHex

            else
                Nothing

        resolve name =
            Dict.get name input.tokens
                |> Maybe.andThen (\value -> Studio.resolveTokenColor input.tokens value 0)

        pick slot names =
            case anchor slot of
                Just rgb ->
                    Just rgb

                Nothing ->
                    firstJust (List.map resolve names)

        bg =
            pick "bg" [ "--ink" ] |> Maybe.withDefault house.bg

        light =
            Theme.relativeLuminance bg > 0.18

        panel =
            pick "panel" [ "--stone" ] |> Maybe.withDefault (stepFrom bg light 0.035)

        panel2 =
            pick "panel-2" [ "--stone-2" ] |> Maybe.withDefault (stepFrom bg light 0.07)

        lineRaw =
            pick "line" [ "--stone-line" ] |> Maybe.withDefault (stepFrom bg light 0.12)

        textGrounds =
            [ bg, panel, panel2 ]

        uiGrounds =
            [ bg, panel ]

        poleText =
            if light then
                black

            else
                white

        text =
            pick "text" [ "--paper" ] |> Maybe.withDefault poleText |> ensure targets.text textGrounds

        dim =
            pick "dim" [ "--paper-dim" ] |> Maybe.withDefault (mixRgb text bg 0.35) |> ensure targets.dim textGrounds

        faint =
            pick "faint" [ "--paper-mute" ]
                |> Maybe.withDefault (mixRgb text bg 0.55)
                |> ensure targets.faint textGrounds

        accent =
            pick "accent" [ "--lapis" ] |> Maybe.withDefault house.accent |> ensure targets.accent uiGrounds

        accentInk =
            bestOn accent
                targets.accentInk
                (List.filterMap identity [ anchor "accent-ink", resolve "--on-accent" ] ++ [ bg, text, black, white ])

        warn =
            pick "warn" [ "--warn", "--gold" ] |> Maybe.withDefault house.warn |> ensure targets.status uiGrounds

        bad =
            pick "bad" [ "--danger", "--shu" ] |> Maybe.withDefault house.bad |> ensure targets.status uiGrounds

        success =
            pick "success" [ "--ok" ] |> Maybe.withDefault accent |> ensure targets.status uiGrounds

        line =
            ensure targets.line uiGrounds lineRaw
    in
    { bg = Theme.rgbToHex bg
    , panel = Theme.rgbToHex panel
    , panel2 = Theme.rgbToHex panel2
    , line = Theme.rgbToHex line
    , text = Theme.rgbToHex text
    , dim = Theme.rgbToHex dim
    , faint = Theme.rgbToHex faint
    , accent = Theme.rgbToHex accent
    , accentInk = Theme.rgbToHex accentInk
    , warn = Theme.rgbToHex warn
    , bad = Theme.rgbToHex bad
    , success = Theme.rgbToHex success
    }


{-| A shell as `( slot, value )` pairs, in `slotNames` order. -}
toPairs : Shell -> List ( Slot, String )
toPairs shell =
    [ ( "bg", shell.bg )
    , ( "panel", shell.panel )
    , ( "panel-2", shell.panel2 )
    , ( "line", shell.line )
    , ( "text", shell.text )
    , ( "dim", shell.dim )
    , ( "faint", shell.faint )
    , ( "accent", shell.accent )
    , ( "accent-ink", shell.accentInk )
    , ( "warn", shell.warn )
    , ( "bad", shell.bad )
    , ( "success", shell.success )
    ]


{-| True when the shell ground is light. -}
isLight : Shell -> Bool
isLight shell =
    Theme.parseHex shell.bg
        |> Maybe.map (\rgb -> Theme.relativeLuminance rgb > 0.18)
        |> Maybe.withDefault False


{-| The inline pairs `appearanceApply` commits: the base set as
`--onyx-theme-<slot>`, the high-contrast set as `--onyx-theme-hc-<slot>`.
-}
commitTokens : { themeId : String, base : Dict String String, tokens : Dict String String } -> List ( String, String )
commitTokens input =
    let
        normal =
            derive { themeId = input.themeId, base = input.base, tokens = input.tokens, highContrast = False }

        high =
            derive { themeId = input.themeId, base = input.base, tokens = input.tokens, highContrast = True }
    in
    List.map (\( slot, value ) -> ( "--onyx-theme-" ++ slot, value )) (toPairs normal)
        ++ List.map (\( slot, value ) -> ( "--onyx-theme-hc-" ++ slot, value )) (toPairs high)


{-| Every contrast pair that misses its target in a derived shell
(`[]` when the shell is clean) — the test gate for every built-in
theme. Labels name the pair and its ratio. -}
contrastFailures : Bool -> Shell -> List String
contrastFailures highContrast shell =
    let
        targets =
            targetsFor highContrast

        get =
            Theme.parseHex >> Maybe.withDefault black

        textGrounds =
            [ ( "bg", shell.bg ), ( "panel", shell.panel ), ( "panel-2", shell.panel2 ) ]

        uiGrounds =
            [ ( "bg", shell.bg ), ( "panel", shell.panel ) ]

        check name fg target grounds =
            List.filterMap
                (\( groundName, ground ) ->
                    let
                        ratio =
                            Theme.contrastRatio (get fg) (get ground)
                    in
                    if ratio + 0.0001 < target then
                        Just (name ++ " on " ++ groundName ++ " " ++ String.fromFloat (toFloat (round (ratio * 100)) / 100) ++ " < " ++ String.fromFloat target)

                    else
                        Nothing
                )
                grounds
    in
    check "text" shell.text targets.text textGrounds
        ++ check "dim" shell.dim targets.dim textGrounds
        ++ check "faint" shell.faint targets.faint textGrounds
        ++ check "accent" shell.accent targets.accent uiGrounds
        ++ check "accent-ink" shell.accentInk targets.accentInk [ ( "accent", shell.accent ) ]
        ++ check "warn" shell.warn targets.status uiGrounds
        ++ check "bad" shell.bad targets.status uiGrounds
        ++ check "success" shell.success targets.status uiGrounds
        ++ check "line" shell.line targets.line uiGrounds



-- ── Colour helpers ───────────────────────────────────────────────────


house : { bg : Theme.Rgb, accent : Theme.Rgb, warn : Theme.Rgb, bad : Theme.Rgb }
house =
    { bg = { r = 11, g = 14, b = 18 }
    , accent = { r = 70, g = 192, b = 138 }
    , warn = { r = 217, g = 161, b = 59 }
    , bad = { r = 229, g = 72, b = 77 }
    }


black : Theme.Rgb
black =
    { r = 0, g = 0, b = 0 }


white : Theme.Rgb
white =
    { r = 255, g = 255, b = 255 }


firstJust : List (Maybe a) -> Maybe a
firstJust items =
    case items of
        [] ->
            Nothing

        (Just x) :: _ ->
            Just x

        Nothing :: rest ->
            firstJust rest


worstRatio : Theme.Rgb -> List Theme.Rgb -> Float
worstRatio fg grounds =
    List.foldl (\ground acc -> min acc (Theme.contrastRatio fg ground)) 21 grounds


{-| Nudge `fg` in OKLCH lightness (hue/chroma kept, gamut-fit) away
from its grounds until the worst pair clears `target`; the text pole
(black / white) is the last resort. Already-passing colours return
unchanged, so a clean palette is never touched. -}
ensure : Float -> List Theme.Rgb -> Theme.Rgb -> Theme.Rgb
ensure target grounds fg =
    if worstRatio fg grounds >= target then
        fg

    else
        let
            groundLum =
                List.foldl (\g acc -> acc + Theme.relativeLuminance g) 0 grounds / toFloat (max 1 (List.length grounds))

            lighter =
                groundLum < 0.18

            start =
                Theme.rgbToOklch fg

            dir =
                if lighter then
                    0.01

                else
                    -0.01

            pole =
                if lighter then
                    white

                else
                    black

            go l i =
                if i <= 0 || l > 1 || l < 0 then
                    pole

                else
                    let
                        candidate =
                            Theme.oklchToRgb { l = l, c = start.c, h = start.h }
                    in
                    if worstRatio candidate grounds >= target then
                        candidate

                    else
                        go (l + dir) (i - 1)
        in
        go (start.l + dir) 101


{-| The first candidate that clears `target` on `ground`, else the one
with the best ratio. -}
bestOn : Theme.Rgb -> Float -> List Theme.Rgb -> Theme.Rgb
bestOn ground target candidates =
    case List.filter (\c -> Theme.contrastRatio c ground >= target) candidates of
        first :: _ ->
            first

        [] ->
            List.foldl
                (\c best ->
                    if Theme.contrastRatio c ground > Theme.contrastRatio best ground then
                        c

                    else
                        best
                )
                black
                candidates


{-| A surface one step off the ground (lighter on dark grounds, darker
on light ones), for themes that lack a stone token. -}
stepFrom : Theme.Rgb -> Bool -> Float -> Theme.Rgb
stepFrom ground light amount =
    let
        ok =
            Theme.rgbToOklch ground
    in
    Theme.oklchToRgb
        { l =
            if light then
                ok.l - amount

            else
                ok.l + amount
        , c = ok.c
        , h = ok.h
        }


mixRgb : Theme.Rgb -> Theme.Rgb -> Float -> Theme.Rgb
mixRgb a b t =
    let
        m x y =
            round (toFloat x + (toFloat y - toFloat x) * t)
    in
    { r = m a.r b.r, g = m a.g b.g, b = m a.b b.b }
