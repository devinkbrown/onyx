module Studio exposing
    ( AdjustState
    , AuditRow
    , ContrastPair
    , CustomTheme
    , StudioGroup
    , StudioToken
    , StudioTokenType(..)
    , addCustomTheme
    , adjustIdentity
    , allStudioTokens
    , auditBadgeClass
    , auditContrast
    , auditFailing
    , checkOklchParts
    , containsForbiddenSyntax
    , contrastPairs
    , customThemeIdRegex
    , customThemePrefix
    , customThemeScheme
    , customThemeStorageKey
    , customThemeTokens
    , decodeThemeShare
    , dedupeById
    , diffOverrides
    , editableProperties
    , encodeCustomTheme
    , encodeCustomThemeValue
    , encodeThemeExport
    , encodeThemeShare
    , exportThemeSeed
    , fmtSigned
    , fontTokenKeys
    , formatFixed2
    , hasControlChars
    , isAdjustIdentity
    , isCustomThemeId
    , isSafeCustomThemeToken
    , matchesId
    , maxCustomThemeCandidates
    , maxCustomThemeIdLength
    , maxCustomThemeNameLength
    , maxCustomThemeStorageBytes
    , maxCustomThemes
    , maxSeedExportBytes
    , maxSeedLabelLength
    , maxThemeExportBytes
    , maxThemeShareCodeLength
    , maxTokenEntries
    , maxTokenKeyLength
    , maxTokenValueLength
    , mergeSaveOverrides
    , parseCustomThemeTokenMap
    , parseCustomThemeValue
    , parseSeedEnvelope
    , parseThemeExport
    , parseThemeSeed
    , radiusTokenMax
    , removeCustomTheme
    , resolveTokenColor
    , reviveCustomThemes
    , safeColorAtom
    , safeColorMixPart
    , safeColorValue
    , safeDurationValue
    , safeEasingValue
    , safeOklch
    , safeRadiusValue
    , sampledAccentSeed
    , saveSuggestion
    , schemeCorrectedBase
    , seedExportKind
    , seedExportVersion
    , seedSwatches
    , seedWarnings
    , slugifyThemeName
    , stripControls
    , studioGroups
    , themeShareUrl
    , uniqueCustomId
    , utf8DecodeStrict
    , validExportTimestamp
    , wcagLevel
    )

{-| Theme Studio pure core — Elm port of `src/theme/tokens.ts`
(editable token registry).

The registry names every CSS custom property the live editor may
present as a control, grouped by concern. The token *value* grammar
(`isSafeCustomThemeToken` family) lives below in this same module;
full built-in token *maps* live in `ThemeTokens` (generated from
`src/theme/themes.ts`).
-}

import Base64Url
import Bitwise
import Dict exposing (Dict)
import Json.Decode as Decode
import Json.Encode as Encode
import Regex
import Theme


{-| Control type the Studio renders for a token. -}
type StudioTokenType
    = TokenColor
    | TokenRadius
    | TokenDuration
    | TokenFont
    | TokenEasing


{-| One editable CSS custom property. -}
type alias StudioToken =
    { property : String
    , label : String
    , hint : String
    , tokenType : StudioTokenType
    , step : Maybe Float
    , min : Maybe Float
    , max : Maybe Float
    }


{-| A named group of tokens rendered as one tab. -}
type alias StudioGroup =
    { id : String
    , label : String
    , tokens : List StudioToken
    }


{-| One WCAG pair the live auditor grades. -}
type alias ContrastPair =
    { label : String
    , fg : String
    , bg : String
    , min : Float
    }


{-| A user-saved theme: a built-in base plus token overrides. -}
type alias CustomTheme =
    { id : String
    , name : String
    , base : String
    , overrides : Dict String String
    }


colorToken : String -> String -> String -> StudioToken
colorToken property label hint =
    { property = property
    , label = label
    , hint = hint
    , tokenType = TokenColor
    , step = Nothing
    , min = Nothing
    , max = Nothing
    }


{-| The seven studio groups, 1:1 with `STUDIO_GROUPS`. -}
studioGroups : List StudioGroup
studioGroups =
    [ { id = "surfaces"
      , label = "Surfaces"
      , tokens =
            [ colorToken "--ink" "Ink (base ground)" "The darkest / deepest background layer."
            , colorToken "--ink-2" "Ink-2" "Second deepest ground layer."
            , colorToken "--stone" "Stone" "First visible surface (cards, panels)."
            , colorToken "--stone-2" "Stone-2" "Raised surface (selected / hover states)."
            , colorToken "--stone-3" "Stone-3" "Highest surface (floating elements)."
            ]
      }
    , { id = "accents"
      , label = "Accents"
      , tokens =
            [ colorToken "--lapis" "Lapis (primary accent)" "Deep ultramarine — the dominant cool accent."
            , colorToken "--lapis-bright" "Lapis bright" "Elevated lapis for interactive focus and highlights."
            , colorToken "--lapis-deep" "Lapis deep" "Shadowed lapis for backgrounds behind accent elements."
            , colorToken "--gold" "Gold (seam accents)" "Pyrite warm gold — labels, seam lines, dividers."
            , colorToken "--gold-bright" "Gold bright" "Elevated gold for interactive highlights and primary buttons."
            , colorToken "--gold-deep" "Gold deep" "Shadowed gold for drop-shadows beneath gold elements."
            , colorToken "--shu" "Vermilion" "Single hot accent — use very sparingly (danger, badges)."
            , colorToken "--shu-bright" "Shu bright" "Elevated vermilion for interactive shu states."
            ]
      }
    , { id = "text"
      , label = "Text"
      , tokens =
            [ colorToken "--paper" "Paper (primary text)" "Warm paper tone. Must pass WCAG AA on --ink."
            , colorToken "--paper-dim" "Paper dim (secondary text)" "Dimmed paper for body copy and supporting text."
            , colorToken "--paper-mute" "Paper mute (tertiary text)" "Least prominent text — timestamps, metadata."
            , colorToken "--ok" "Status: OK" "Success / online / positive status colour."
            ]
      }
    , { id = "seams"
      , label = "Seams"
      , tokens =
            [ colorToken "--stone-line" "Stone line" "Subtle divider for adjacent stone surfaces." ]
      }
    , { id = "radius"
      , label = "Radius"
      , tokens =
            [ { property = "--r-0", label = "Sharp (r-0)", hint = "Base radius — 0 px keeps the brutalist identity.", tokenType = TokenRadius, step = Just 1, min = Just 0, max = Just 12 }
            , { property = "--r-sm", label = "Small (r-sm)", hint = "Chips and small badges.", tokenType = TokenRadius, step = Just 1, min = Just 0, max = Just 12 }
            , { property = "--r-md", label = "Medium (r-md)", hint = "Cards and panels.", tokenType = TokenRadius, step = Just 1, min = Just 0, max = Just 16 }
            ]
      }
    , { id = "motion"
      , label = "Motion"
      , tokens =
            [ { property = "--dur", label = "Duration", hint = "Base transition duration in milliseconds.", tokenType = TokenDuration, step = Just 20, min = Just 0, max = Just 600 }
            , { property = "--ease", label = "Easing", hint = "CSS cubic-bezier easing function.", tokenType = TokenEasing, step = Nothing, min = Nothing, max = Nothing }
            ]
      }
    , { id = "fonts"
      , label = "Fonts"
      , tokens =
            [ { property = "--font-mono", label = "Mono stack", hint = "Monospace font — terminal labels, code, controls.", tokenType = TokenFont, step = Nothing, min = Nothing, max = Nothing }
            , { property = "--font-display", label = "Display stack", hint = "Headline / display font — brutalist editorial.", tokenType = TokenFont, step = Nothing, min = Nothing, max = Nothing }
            , { property = "--font-sans", label = "Sans stack", hint = "Body sans-serif for prose and UI copy.", tokenType = TokenFont, step = Nothing, min = Nothing, max = Nothing }
            , { property = "--font-serif", label = "Serif stack", hint = "Humanist serif for editorial and supporting text.", tokenType = TokenFont, step = Nothing, min = Nothing, max = Nothing }
            ]
      }
    ]


{-| Flat list of all editable tokens (validation + import/export). -}
allStudioTokens : List StudioToken
allStudioTokens =
    List.concatMap .tokens studioGroups


{-| Names of all editable properties. -}
editableProperties : List String
editableProperties =
    List.map .property allStudioTokens


{-| Accept only the value grammar consumed by Onyx's finite
theme-token registry (mirroring `isSafeCustomThemeToken`).
-}
isSafeCustomThemeToken : String -> String -> Bool
isSafeCustomThemeToken property value =
    if
        String.isEmpty property
            || String.length property > maxTokenKeyLength
            || String.isEmpty value
            || String.length value > maxTokenValueLength
            || value /= String.trim value
            || hasControlChars value
            || containsForbiddenSyntax value
    then
        False

    else if List.member property colorTokenKeys then
        safeColorValue value

    else if Dict.member property radiusTokenMax then
        safeRadiusValue property value

    else if property == "--dur" then
        safeDurationValue value

    else if property == "--ease" then
        safeEasingValue value

    else if List.member property fontTokenKeys then
        matchesFontStack value

    else
        False


maxTokenKeyLength : Int
maxTokenKeyLength =
    80


maxTokenValueLength : Int
maxTokenValueLength =
    512


maxTokenEntries : Int
maxTokenEntries =
    64


hasControlChars : String -> Bool
hasControlChars value =
    String.any
        (\c ->
            let
                n =
                    Char.toCode c
            in
            n < 32 || n == 127
        )
        value


containsForbiddenSyntax : String -> Bool
containsForbiddenSyntax value =
    case forbiddenSyntaxRegex of
        Just re ->
            Regex.contains re value

        Nothing ->
            -- Fail closed: without the guard regex nothing passes.
            True


forbiddenSyntaxRegex : Maybe Regex.Regex
forbiddenSyntaxRegex =
    Regex.fromStringWith { caseInsensitive = True, multiline = False }
        "[;{}@\\\\]|/\\*|\\*/|(?:url|src|image(?:-set)?|cross-fade|element)\\s*\\("


colorTokenKeys : List String
colorTokenKeys =
    [ "--ink"
    , "--ink-2"
    , "--stone"
    , "--stone-2"
    , "--stone-3"
    , "--stone-line"
    , "--lapis"
    , "--lapis-bright"
    , "--lapis-deep"
    , "--gold"
    , "--gold-bright"
    , "--gold-deep"
    , "--brand-action"
    , "--shu"
    , "--shu-bright"
    , "--paper"
    , "--paper-dim"
    , "--paper-mute"
    , "--ok"
    , "--warn"
    , "--danger"
    , "--seam"
    , "--seam-faint"
    , "--line"
    , "--line-faint"
    ]


radiusTokenMax : Dict String Float
radiusTokenMax =
    Dict.fromList
        [ ( "--r-0", 12 )
        , ( "--r-sm", 12 )
        , ( "--r-md", 16 )
        , ( "--r-pill", 9999 )
        ]


fontTokenKeys : List String
fontTokenKeys =
    [ "--font-mono"
    , "--font-display"
    , "--font-sans"
    , "--font-serif"
    ]


safeNamedColors : List String
safeNamedColors =
    [ "black", "transparent", "white" ]


cssNumberPattern : String
cssNumberPattern =
    "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)"


boundedNumber : String -> Float -> Float -> Bool
boundedNumber raw min max =
    case numberRegex of
        Just re ->
            if Regex.contains re raw then
                case String.toFloat raw of
                    Just parsed ->
                        parsed >= min && parsed <= max

                    Nothing ->
                        False

            else
                False

        Nothing ->
            False


numberRegex : Maybe Regex.Regex
numberRegex =
    Regex.fromString ("^" ++ cssNumberPattern ++ "$")


safeOklch : String -> Bool
safeOklch value =
    case oklchRegex of
        Just re ->
            case Regex.find re (String.toLower value) of
                [ match ] ->
                    checkOklchParts match.submatches

                _ ->
                    False

        Nothing ->
            False


oklchRegex : Maybe Regex.Regex
oklchRegex =
    Regex.fromString
        ("^oklch\\(\\s*("
            ++ cssNumberPattern
            ++ ")(%)?\\s+("
            ++ cssNumberPattern
            ++ ")\\s+("
            ++ cssNumberPattern
            ++ ")(?:deg)?(?:\\s*/\\s*("
            ++ cssNumberPattern
            ++ ")(%)?)?\\s*\\)$"
        )


checkOklchParts : List (Maybe String) -> Bool
checkOklchParts parts =
    case parts of
        [ Just lStr, pctL, Just cStr, Just hStr, alphaStr, pctA ] ->
            let
                lightnessMax =
                    if pctL == Nothing then
                        1

                    else
                        100

                alphaMax =
                    if pctA == Nothing then
                        1

                    else
                        100
            in
            case ( ( String.toFloat lStr, String.toFloat cStr ), String.toFloat hStr ) of
                ( ( Just l, Just c ), Just h ) ->
                    case alphaOf alphaStr of
                        Just a ->
                            l >= 0 && l <= lightnessMax && c >= 0 && c <= 0.5 && abs h <= 3600 && a >= 0 && a <= alphaMax

                        Nothing ->
                            False

                _ ->
                    False

        _ ->
            False


alphaOf : Maybe String -> Maybe Float
alphaOf maybeStr =
    case maybeStr of
        Nothing ->
            Just 1

        Just str ->
            String.toFloat str


safeColorAtom : String -> Bool
safeColorAtom value =
    let
        trimmed =
            String.trim value
    in
    if matchesHexColor trimmed || safeOklch trimmed then
        True

    else if List.member (String.toLower trimmed) safeNamedColors then
        True

    else
        case varRefRegex of
            Just re ->
                case Regex.find re trimmed of
                    [ match ] ->
                        case match.submatches of
                            [ Just name ] ->
                                List.member name colorTokenKeys

                            _ ->
                                False

                    _ ->
                        False

            Nothing ->
                False


matchesHexColor : String -> Bool
matchesHexColor value =
    case hexColorRegex of
        Just re ->
            Regex.contains re value

        Nothing ->
            False


hexColorRegex : Maybe Regex.Regex
hexColorRegex =
    Regex.fromStringWith { caseInsensitive = True, multiline = False }
        "^#[0-9a-f]{3,4}(?:[0-9a-f]{3,4})?$"


varRefRegex : Maybe Regex.Regex
varRefRegex =
    Regex.fromStringWith { caseInsensitive = True, multiline = False }
        "^var\\(\\s*(--[A-Za-z0-9_-]+)\\s*\\)$"


safeColorMixPart : String -> Bool
safeColorMixPart value =
    let
        trimmed =
            String.trim value
    in
    if safeColorAtom trimmed then
        True

    else
        case mixWeightRegex of
            Just re ->
                case Regex.find re trimmed of
                    [ match ] ->
                        case match.submatches of
                            [ Just atom, Just weight ] ->
                                safeColorAtom atom && boundedNumber weight 0 100

                            _ ->
                                False

                    _ ->
                        False

            Nothing ->
                False


mixWeightRegex : Maybe Regex.Regex
mixWeightRegex =
    Regex.fromString "^(.*\\S)\\s+(\\d+(?:\\.\\d+)?)%$"


safeColorValue : String -> Bool
safeColorValue value =
    if safeColorAtom value then
        True

    else
        case colorMixRegex of
            Just re ->
                case Regex.find re value of
                    [ match ] ->
                        case match.submatches of
                            [ Just first, Just second ] ->
                                safeColorMixPart first && safeColorMixPart second

                            _ ->
                                False

                    _ ->
                        False

            Nothing ->
                False


colorMixRegex : Maybe Regex.Regex
colorMixRegex =
    Regex.fromStringWith { caseInsensitive = True, multiline = False }
        "^color-mix\\(\\s*in\\s+oklab\\s*,\\s*([^,]+)\\s*,\\s*([^,]+)\\s*\\)$"


safeRadiusValue : String -> String -> Bool
safeRadiusValue property value =
    case Dict.get property radiusTokenMax of
        Nothing ->
            False

        Just max ->
            case radiusValueRegex of
                Just re ->
                    case Regex.find re value of
                        [ match ] ->
                            case match.submatches of
                                [ Just amount ] ->
                                    boundedNumber amount 0 max

                                _ ->
                                    False

                        _ ->
                            False

                Nothing ->
                    False


radiusValueRegex : Maybe Regex.Regex
radiusValueRegex =
    Regex.fromString "^(\\d+(?:\\.\\d+)?)px$"


safeDurationValue : String -> Bool
safeDurationValue value =
    case durationValueRegex of
        Just re ->
            case Regex.find re value of
                [ match ] ->
                    case match.submatches of
                        [ Just amount ] ->
                            boundedNumber amount 0 5000

                        _ ->
                            False

                _ ->
                    False

        Nothing ->
            False


durationValueRegex : Maybe Regex.Regex
durationValueRegex =
    Regex.fromString "^(\\d+(?:\\.\\d+)?)ms$"


safeEasingValue : String -> Bool
safeEasingValue value =
    let
        normalized =
            String.toLower value
    in
    if List.member normalized easingKeywords then
        True

    else
        case stepsRegex of
            Just steps ->
                if Regex.contains steps value then
                    True

                else
                    checkCubicBezier value

            Nothing ->
                False


easingKeywords : List String
easingKeywords =
    [ "ease", "ease-in", "ease-in-out", "ease-out", "linear" ]


stepsRegex : Maybe Regex.Regex
stepsRegex =
    Regex.fromStringWith { caseInsensitive = True, multiline = False }
        "^(?:steps\\(\\s*([1-9]\\d{0,2})(?:\\s*,\\s*(?:start|end|jump-start|jump-end|jump-none|jump-both))?\\s*\\)|step-start|step-end)$"


checkCubicBezier : String -> Bool
checkCubicBezier value =
    case cubicBezierRegex of
        Just re ->
            case Regex.find re value of
                [ match ] ->
                    case List.filterMap identity match.submatches of
                        [ x1, _, x2, _ ] ->
                            case ( String.toFloat x1, String.toFloat x2 ) of
                                ( Just a, Just b ) ->
                                    a >= 0 && a <= 1 && b >= 0 && b <= 1

                                _ ->
                                    False

                        _ ->
                            False

                _ ->
                    False

        Nothing ->
            False


cubicBezierRegex : Maybe Regex.Regex
cubicBezierRegex =
    Regex.fromStringWith { caseInsensitive = True, multiline = False }
        ("^cubic-bezier\\(\\s*("
            ++ cssNumberPattern
            ++ ")\\s*,\\s*("
            ++ cssNumberPattern
            ++ ")\\s*,\\s*("
            ++ cssNumberPattern
            ++ ")\\s*,\\s*("
            ++ cssNumberPattern
            ++ ")\\s*\\)$"
        )


matchesFontStack : String -> Bool
matchesFontStack value =
    case fontStackRegex of
        Just re ->
            Regex.contains re value

        Nothing ->
            False


fontStackRegex : Maybe Regex.Regex
fontStackRegex =
    let
        name =
            "(?:\"[A-Za-z0-9 ._-]{1,80}\"|'[A-Za-z0-9 ._-]{1,80}'|[A-Za-z-][A-Za-z0-9 _-]{0,79})"
    in
    Regex.fromString ("^" ++ name ++ "(?:\\s*,\\s*" ++ name ++ "){0,15}$")


customThemePrefix : String
customThemePrefix =
    "custom:"


maxCustomThemes : Int
maxCustomThemes =
    32


maxCustomThemeCandidates : Int
maxCustomThemeCandidates =
    128


maxCustomThemeIdLength : Int
maxCustomThemeIdLength =
    128


maxCustomThemeNameLength : Int
maxCustomThemeNameLength =
    80


maxCustomThemeStorageBytes : Int
maxCustomThemeStorageBytes =
    256 * 1024


maxThemeExportBytes : Int
maxThemeExportBytes =
    64 * 1024


maxSeedExportBytes : Int
maxSeedExportBytes =
    16 * 1024


maxSeedLabelLength : Int
maxSeedLabelLength =
    80


maxThemeShareCodeLength : Int
maxThemeShareCodeLength =
    65536


customThemeStorageKey : String
customThemeStorageKey =
    "onyx:custom-themes"


{-| True when `id` names a user-created theme rather than a built-in. -}
isCustomThemeId : String -> Bool
isCustomThemeId id =
    String.startsWith customThemePrefix id


customThemeIdRegex : Maybe Regex.Regex
customThemeIdRegex =
    Regex.fromString "^custom:[a-z0-9](?:[a-z0-9-]{0,119})$"


{-| Validate a token map: plain object, finite registry, narrow
value grammar per entry (mirroring `parseCustomThemeTokenMap`).
-}
parseCustomThemeTokenMap : Decode.Value -> Maybe (Dict String String)
parseCustomThemeTokenMap value =
    case Decode.decodeValue (Decode.dict Decode.string) value of
        Err _ ->
            Nothing

        Ok entries ->
            if Dict.size entries > maxTokenEntries then
                Nothing

            else if Dict.toList entries |> List.all (\( key, token ) -> isSafeCustomThemeToken key token) then
                Just entries

            else
                Nothing


{-| Validate one stored custom theme (mirroring `parseCustomThemeValue`).
The base id is checked against the caller's built-in set.
-}
parseCustomThemeValue : List String -> Decode.Value -> Maybe CustomTheme
parseCustomThemeValue builtinIds value =
    case Decode.decodeValue themeValueDecoder value of
        Err _ ->
            Nothing

        Ok raw ->
            if
                String.length raw.id > maxCustomThemeIdLength
                    || not (matchesId raw.id)
                    || String.isEmpty raw.name
                    || String.length raw.name > maxCustomThemeNameLength
                    || raw.name /= String.trim raw.name
                    || hasControlChars raw.name
                    || not (List.member raw.base builtinIds)
            then
                Nothing

            else
                case parseCustomThemeTokenMap raw.overrides of
                    Nothing ->
                        Nothing

                    Just overrides ->
                        Just { id = raw.id, name = raw.name, base = raw.base, overrides = overrides }


type alias RawThemeValue =
    { id : String
    , name : String
    , base : String
    , overrides : Decode.Value
    }


themeValueDecoder : Decode.Decoder RawThemeValue
themeValueDecoder =
    Decode.map4 RawThemeValue
        (Decode.field "id" Decode.string)
        (Decode.field "name" Decode.string)
        (Decode.field "base" Decode.string)
        (Decode.field "overrides" Decode.value)


matchesId : String -> Bool
matchesId id =
    case customThemeIdRegex of
        Just re ->
            Regex.contains re id

        Nothing ->
            False


{-| Revive a stored custom-theme list: length caps, per-value
validation, first-id-wins dedupe (mirroring `loadCustomThemes`).
Takes the raw storage string so ports own the localStorage read.
-}
reviveCustomThemes : List String -> String -> List CustomTheme
reviveCustomThemes builtinIds serialized =
    if String.isEmpty serialized || String.length serialized > maxCustomThemeStorageBytes then
        []

    else
        case Decode.decodeString (Decode.list Decode.value) serialized of
            Err _ ->
                []

            Ok raw ->
                List.take maxCustomThemeCandidates raw
                    |> List.filterMap (parseCustomThemeValue builtinIds)
                    |> dedupeById []


dedupeById : List CustomTheme -> List CustomTheme -> List CustomTheme
dedupeById seen remaining =
    case remaining of
        [] ->
            List.reverse seen

        theme :: rest ->
            if List.any (\known -> known.id == theme.id) seen then
                dedupeById seen rest

            else if List.length seen >= maxCustomThemes then
                List.reverse seen

            else
                dedupeById (theme :: seen) rest


{-| Slugify a theme name for id derivation (mirroring `slugify`). -}
slugifyThemeName : String -> String
slugifyThemeName name =
    String.toLower name
        |> String.toList
        -- The oracle maps every `[^a-z0-9]` run to one dash, so only
        -- ASCII alphanumerics survive (never `Char.isAlphaNum`).
        |> List.map (\c -> if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') then c else '-')
        |> String.fromList
        |> collapseDashes
        |> stripEdgeDashes


collapseDashes : String -> String
collapseDashes value =
    String.foldl
        (\c acc ->
            if c == '-' && String.endsWith "-" acc then
                acc

            else
                acc ++ String.fromChar c
        )
        ""
        value


stripEdgeDashes : String -> String
stripEdgeDashes value =
    let
        trimLeft str =
            if String.startsWith "-" str then
                trimLeft (String.dropLeft 1 str)

            else
                str

        trimRight str =
            if String.endsWith "-" str then
                trimRight (String.dropRight 1 str)

            else
                str
    in
    value |> trimLeft |> trimRight |> (\s -> if String.isEmpty s then "theme" else s)


{-| Create a custom theme record with a unique id (mirroring
`addCustomTheme` minus the storage write, which is ports-side).
Returns the theme plus the list to persist (cap: keep the newest 32).
-}
addCustomTheme : List String -> List CustomTheme -> String -> String -> Dict String String -> ( CustomTheme, List CustomTheme )
addCustomTheme builtinIds existing name base overrides =
    let
        safeName =
            stripControls name
                |> String.trim
                |> (\trimmed -> String.left maxCustomThemeNameLength trimmed)
                |> (\trimmed -> if String.isEmpty trimmed then "Custom" else trimmed)

        safeBase =
            if List.member base builtinIds then
                base

            else
                "onyx"

        -- The oracle seats `parseCustomThemeTokenMap(overrides) ?? {}`:
        -- one unsafe entry (or over-count) discards the WHOLE map,
        -- never a filtered subset.
        safeOverrides =
            let
                pairs =
                    Dict.toList overrides
            in
            if List.length pairs > maxTokenEntries then
                Dict.empty

            else if List.all (\( key, token ) -> isSafeCustomThemeToken key token) pairs then
                Dict.fromList pairs

            else
                Dict.empty

        slug =
            slugifyThemeName safeName

        id =
            uniqueCustomId existing slug 1

        theme =
            { id = id, name = safeName, base = safeBase, overrides = safeOverrides }

        persisted =
            List.take (maxCustomThemes - 1) (List.drop (List.length existing - (maxCustomThemes - 1)) existing) ++ [ theme ]
    in
    ( theme, persisted )


stripControls : String -> String
stripControls value =
    String.filter
        (\c ->
            let
                n =
                    Char.toCode c
            in
            n >= 32 && n /= 127
        )
        value


uniqueCustomId : List CustomTheme -> String -> Int -> String
uniqueCustomId existing slug n =
    -- The oracle recomputes from the slug every pass
    -- (`custom:slug`, then `custom:slug-2`, `custom:slug-3`, …).
    let
        candidate =
            if n <= 1 then
                customThemePrefix ++ slug

            else
                customThemePrefix ++ slug ++ "-" ++ String.fromInt n
    in
    if List.any (\theme -> theme.id == candidate) existing then
        uniqueCustomId existing slug (n + 1)

    else
        candidate


{-| Drop a custom theme by id (mirroring `removeCustomTheme` minus
the storage write). -}
removeCustomTheme : List CustomTheme -> String -> List CustomTheme
removeCustomTheme existing id =
    List.filter (\theme -> theme.id /= id) existing


{-| Effective tokens: base tokens overlaid with overrides. -}
customThemeTokens : Dict String String -> CustomTheme -> Dict String String
customThemeTokens baseTokens theme =
    Dict.union theme.overrides baseTokens


{-| Light/dark scheme inherited from the custom theme's base. -}
customThemeScheme : (String -> Maybe String) -> CustomTheme -> String
customThemeScheme schemeOf theme =
    schemeOf theme.base |> Maybe.withDefault "dark"


{-| Encode a theme for storage / share (mirroring the persisted shape). -}
encodeCustomTheme : CustomTheme -> String
encodeCustomTheme theme =
    Encode.encode 0 (encodeCustomThemeValue theme)


encodeCustomThemeValue : CustomTheme -> Decode.Value
encodeCustomThemeValue theme =
    Encode.object
        [ ( "id", Encode.string theme.id )
        , ( "name", Encode.string theme.name )
        , ( "base", Encode.string theme.base )
        , ( "overrides"
          , Encode.object
                (Dict.toList theme.overrides |> List.map (\( key, value ) -> ( key, Encode.string value )))
          )
        ]


{-| Parse a pasted Theme Studio export without seating untrusted
values (mirroring `parseThemeExport`). The timestamp must be a
valid `YYYY-MM-DDTHH:MM:SS.mmmZ` instant.
-}
parseThemeExport : List String -> String -> Result String { base : String, overrides : Dict String String, exported : String }
parseThemeExport builtinIds raw =
    if String.length raw > maxThemeExportBytes then
        Err "Theme export is too large."

    else
        case Decode.decodeString exportBlobDecoder raw of
            Err _ ->
                Err "Not a valid Onyx theme export."

            Ok blob ->
                if not blob.marker then
                    Err "Not a valid Onyx theme export."

                else if not (List.member blob.base builtinIds) then
                    Err ("Unknown base theme \"" ++ String.left 80 blob.base ++ "\".")

                else
                    case parseCustomThemeTokenMap blob.overrides of
                        Nothing ->
                            Err "Not a valid Onyx theme export."

                        Just overrides ->
                            if validExportTimestamp blob.exported then
                                Ok { base = blob.base, overrides = overrides, exported = blob.exported }

                            else
                                Err "Not a valid Onyx theme export."


type alias RawExportBlob =
    { marker : Bool
    , base : String
    , overrides : Decode.Value
    , exported : String
    }


exportBlobDecoder : Decode.Decoder RawExportBlob
exportBlobDecoder =
    Decode.map4 RawExportBlob
        (Decode.field "__onyx_theme_export__" Decode.bool)
        (Decode.field "base" Decode.string)
        (Decode.field "overrides" Decode.value)
        (Decode.field "exported" Decode.string)


validExportTimestamp : String -> Bool
validExportTimestamp value =
    case exportTimestampRegex of
        Just re ->
            Regex.contains re value

        Nothing ->
            False


exportTimestampRegex : Maybe Regex.Regex
exportTimestampRegex =
    Regex.fromString "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"


{-| Serialize the current override set as an export blob. The
timestamp arrives from ports (Elm has no clock read here). -}
encodeThemeExport : String -> Dict String String -> String -> String
encodeThemeExport base overrides exported =
    Encode.encode 2
        (Encode.object
            [ ( "__onyx_theme_export__", Encode.bool True )
            , ( "base", Encode.string base )
            , ( "overrides"
              , Encode.object
                    (Dict.toList overrides |> List.map (\( key, value ) -> ( key, Encode.string value )))
              )
            , ( "exported", Encode.string exported )
            ]
        )


seedExportKind : String
seedExportKind =
    "onyx-theme-seed"


seedExportVersion : Int
seedExportVersion =
    1


bannedHueMin : Float
bannedHueMin =
    258


bannedHueMax : Float
bannedHueMax =
    342


{-| Serialize a seed + label as a portable JSON envelope
(mirroring `exportThemeSeed`). -}
exportThemeSeed : String -> Theme.PaletteSeed -> String
exportThemeSeed label seed =
    let
        cleanLabel =
            String.trim label |> (\trimmed -> String.left maxSeedLabelLength trimmed) |> (\trimmed -> if String.isEmpty trimmed then "Custom" else trimmed)
    in
    Encode.encode 2
        (Encode.object
            [ ( "kind", Encode.string seedExportKind )
            , ( "version", Encode.int seedExportVersion )
            , ( "label", Encode.string cleanLabel )
            , ( "seed"
              , Encode.object
                    [ ( "scheme", Encode.string seed.scheme )
                    , ( "primaryHue", Encode.float seed.primaryHue )
                    , ( "accentHue", Encode.float seed.accentHue )
                    , ( "depth", Encode.float seed.depth )
                    , ( "vibrancy", Encode.float seed.vibrancy )
                    , ( "warmth", Encode.float seed.warmth )
                    , ( "contrast", Encode.float seed.contrast )
                    ]
              )
            ]
        )


{-| Parse + fully validate a portable seed envelope, fail-closed
(mirroring `parseThemeSeed`). -}
parseThemeSeed : String -> Result String { label : String, seed : Theme.PaletteSeed, warnings : List String }
parseThemeSeed raw =
    if String.length raw > maxSeedExportBytes then
        Err "Theme-seed export is too large."

    else
        case Decode.decodeString Decode.value raw of
            Err _ ->
                Err "Invalid JSON — could not parse."

            Ok value ->
                case Decode.decodeValue (Decode.dict Decode.value) value of
                    Err _ ->
                        Err "Not a theme-seed export."

                    Ok envelope ->
                        parseSeedEnvelope envelope


parseSeedEnvelope : Dict String Decode.Value -> Result String { label : String, seed : Theme.PaletteSeed, warnings : List String }
parseSeedEnvelope envelope =
    let
        field name =
            Dict.get name envelope
    in
    case field "kind" of
        Just kindValue ->
            case Decode.decodeValue Decode.string kindValue of
                Ok kind ->
                    if kind /= seedExportKind then
                        Err "Not an Onyx theme-seed export."

                    else
                        parseSeedVersion envelope

                Err _ ->
                    Err "Not an Onyx theme-seed export."

        Nothing ->
            Err "Not an Onyx theme-seed export."


parseSeedVersion : Dict String Decode.Value -> Result String { label : String, seed : Theme.PaletteSeed, warnings : List String }
parseSeedVersion envelope =
    case Dict.get "version" envelope of
        Just versionValue ->
            case Decode.decodeValue Decode.float versionValue of
                Ok version ->
                    if version /= toFloat seedExportVersion then
                        Err ("Unsupported seed version \"" ++ renderJsonScalar versionValue ++ "\".")

                    else
                        parseSeedLabel envelope

                Err _ ->
                    Err ("Unsupported seed version \"" ++ renderJsonScalar versionValue ++ "\".")

        Nothing ->
            Err "Unsupported seed version \"undefined\"."


renderJsonScalar : Decode.Value -> String
renderJsonScalar value =
    case Decode.decodeValue Decode.string value of
        Ok str ->
            str

        Err _ ->
            case Decode.decodeValue Decode.float value of
                Ok num ->
                    floatToJsString num

                Err _ ->
                    case Decode.decodeValue Decode.bool value of
                        Ok flag ->
                            if flag then
                                "true"

                            else
                                "false"

                        Err _ ->
                            case Decode.decodeValue (Decode.list Decode.value) value of
                                Ok items ->
                                    String.join "," (List.map renderJsonScalar items)

                                Err _ ->
                                    "[object Object]"


floatToJsString : Float -> String
floatToJsString num =
    -- `String(x)` for finite JSON numbers; the seed ranges reject
    -- non-finite values before any float reaches here.
    String.fromFloat num


parseSeedLabel : Dict String Decode.Value -> Result String { label : String, seed : Theme.PaletteSeed, warnings : List String }
parseSeedLabel envelope =
    case Dict.get "label" envelope of
        Just labelValue ->
            case Decode.decodeValue Decode.string labelValue of
                Ok label ->
                    if String.isEmpty (String.trim label) then
                        Err "Missing theme label."

                    else if String.length label > maxSeedLabelLength then
                        Err "Theme label is too long."

                    else
                        parseSeedBody (String.trim label) envelope

                Err _ ->
                    Err "Missing theme label."

        Nothing ->
            Err "Missing theme label."


parseSeedBody : String -> Dict String Decode.Value -> Result String { label : String, seed : Theme.PaletteSeed, warnings : List String }
parseSeedBody label envelope =
    case Dict.get "seed" envelope of
        Just seedValue ->
            case Decode.decodeValue (Decode.dict Decode.value) seedValue of
                Ok seedDict ->
                    parseSeedFields label seedDict

                Err _ ->
                    Err "Missing seed."

        Nothing ->
            Err "Missing seed."


parseSeedFields : String -> Dict String Decode.Value -> Result String { label : String, seed : Theme.PaletteSeed, warnings : List String }
parseSeedFields label seedDict =
    case Dict.get "scheme" seedDict of
        Just schemeValue ->
            case Decode.decodeValue Decode.string schemeValue of
                Ok scheme ->
                    if scheme /= "dark" && scheme /= "light" then
                        Err "Seed scheme must be \"dark\" or \"light\"."

                    else
                        checkSeedRanges label scheme seedDict seedRangeFields

                Err _ ->
                    Err "Seed scheme must be \"dark\" or \"light\"."

        Nothing ->
            Err "Seed scheme must be \"dark\" or \"light\"."


seedRangeFields : List ( String, Float, Float )
seedRangeFields =
    [ ( "primaryHue", 0, 360 )
    , ( "accentHue", 0, 360 )
    , ( "depth", 0, 1 )
    , ( "vibrancy", 0, 1 )
    , ( "warmth", -1, 1 )
    , ( "contrast", 4.5, 21 )
    ]


checkSeedRanges : String -> String -> Dict String Decode.Value -> List ( String, Float, Float ) -> Result String { label : String, seed : Theme.PaletteSeed, warnings : List String }
checkSeedRanges label scheme seedDict fields =
    case fields of
        [] ->
            case buildSeed scheme seedDict of
                Just seed ->
                    Ok { label = label, seed = seed, warnings = seedWarnings seed }

                Nothing ->
                    Err "Missing seed."

        ( name, min, max ) :: rest ->
            case Dict.get name seedDict of
                Just raw ->
                    case Decode.decodeValue Decode.float raw of
                        Ok num ->
                            if num >= min && num <= max then
                                checkSeedRanges label scheme seedDict rest

                            else
                                Err (seedRangeError name min max)

                        Err _ ->
                            Err (seedRangeError name min max)

                Nothing ->
                    Err (seedRangeError name min max)


seedRangeError : String -> Float -> Float -> String
seedRangeError name min max =
    "Seed \"" ++ name ++ "\" must be a number in [" ++ rangeBound min ++ ", " ++ rangeBound max ++ "]."


rangeBound : Float -> String
rangeBound bound =
    if bound == toFloat (round bound) then
        String.fromInt (round bound)

    else
        String.fromFloat bound


buildSeed : String -> Dict String Decode.Value -> Maybe Theme.PaletteSeed
buildSeed scheme seedDict =
    let
        number name =
            Dict.get name seedDict |> Maybe.andThen (\raw -> Decode.decodeValue Decode.float raw |> Result.toMaybe)
    in
    case ( ( number "primaryHue", number "accentHue" ), ( number "depth", number "vibrancy" ), ( number "warmth", number "contrast" ) ) of
        ( ( Just primaryHue, Just accentHue ), ( Just depth, Just vibrancy ), ( Just warmth, Just contrast ) ) ->
            Just
                { scheme = scheme
                , primaryHue = primaryHue
                , accentHue = accentHue
                , depth = depth
                , vibrancy = vibrancy
                , warmth = warmth
                , contrast = contrast
                }

        _ ->
            Nothing


seedWarnings : Theme.PaletteSeed -> List String
seedWarnings seed =
    List.filterMap identity
        [ if seed.primaryHue >= bannedHueMin && seed.primaryHue <= bannedHueMax then
            Just ("Primary hue " ++ String.fromInt (round seed.primaryHue) ++ "° is in the banned 258–342° arc; it will be snapped to the nearer edge.")

          else
            Nothing
        , if seed.accentHue >= bannedHueMin && seed.accentHue <= bannedHueMax then
            Just ("Accent hue " ++ String.fromInt (round seed.accentHue) ++ "° is in the banned 258–342° arc; it will be snapped to the nearer edge.")

          else
            Nothing
        ]


{-| Encode a custom theme as a share code: base64url over the UTF-8
JSON bytes (mirroring `encodeTheme`). A runtime-invalid theme
encodes to `""` and is never seated. -}
encodeThemeShare : List String -> CustomTheme -> String
encodeThemeShare builtinIds theme =
    case parseCustomThemeValue builtinIds (encodeCustomThemeValue theme) of
        Just _ ->
            Base64Url.encode (Base64Url.utf8Bytes (encodeCustomTheme theme))

        Nothing ->
            ""


{-| Share URL for a saved custom theme (mirroring `themeShareUrl`). -}
themeShareUrl : List String -> CustomTheme -> String -> String
themeShareUrl builtinIds theme origin =
    origin ++ "?theme=" ++ encodeThemeShare builtinIds theme


{-| Decode a `?theme=` share code, fail-closed (mirroring
`decodeTheme`): length cap, canonical base64url (re-encoded bytes
must round-trip, rejecting non-zero trailing bits), strict UTF-8
(`fatal:true` parity — overlongs, surrogates, truncations reject),
then the same `parseCustomThemeValue` boundary as storage.
-}
decodeThemeShare : List String -> String -> Maybe CustomTheme
decodeThemeShare builtinIds code =
    if String.isEmpty code || String.length code > maxThemeShareCodeLength then
        Nothing

    else
        case Base64Url.decode code of
            Nothing ->
                Nothing

            Just bytes ->
                if Base64Url.encode bytes /= code then
                    Nothing

                else
                    case utf8DecodeStrict bytes of
                        Nothing ->
                            Nothing

                        Just json ->
                            case Decode.decodeString Decode.value json of
                                Err _ ->
                                    Nothing

                                Ok value ->
                                    parseCustomThemeValue builtinIds value


{-| Strict UTF-8 bytes → String (`TextDecoder('utf-8', {fatal:true})`
parity). Rejects overlong forms, surrogate halves, out-of-range
code points, truncated tails, and stray continuation bytes.
-}
utf8DecodeStrict : List Int -> Maybe String
utf8DecodeStrict bytes =
    utf8DecodeLoop bytes []


utf8DecodeLoop : List Int -> List Char -> Maybe String
utf8DecodeLoop bytes acc =
    case bytes of
        [] ->
            Just (String.fromList (List.reverse acc))

        b :: rest ->
            if b < 0x80 then
                utf8DecodeLoop rest (Char.fromCode b :: acc)

            else if b >= 0xC2 && b <= 0xDF then
                case rest of
                    c :: rest2 ->
                        if c >= 0x80 && c <= 0xBF then
                            utf8DecodeLoop rest2 (Char.fromCode (lead2 b c) :: acc)

                        else
                            Nothing

                    [] ->
                        Nothing

            else if b >= 0xE0 && b <= 0xEF then
                case rest of
                    c1 :: c2 :: rest3 ->
                        if validContinuation c1 && validContinuation c2 && validTriple b c1 then
                            utf8DecodeLoop rest3 (Char.fromCode (lead3 b c1 c2) :: acc)

                        else
                            Nothing

                    _ ->
                        Nothing

            else if b >= 0xF0 && b <= 0xF4 then
                case rest of
                    c1 :: c2 :: c3 :: rest4 ->
                        if validContinuation c1 && validContinuation c2 && validContinuation c3 && validQuad b c1 then
                            utf8DecodeLoop rest4 (Char.fromCode (lead4 b c1 c2 c3) :: acc)

                        else
                            Nothing

                    _ ->
                        Nothing

            else
                Nothing


validContinuation : Int -> Bool
validContinuation c =
    c >= 0x80 && c <= 0xBF


lead2 : Int -> Int -> Int
lead2 b c =
    Bitwise.or (Bitwise.shiftLeftBy 6 (Bitwise.and 0x1F b)) (Bitwise.and 0x3F c)


validTriple : Int -> Int -> Bool
validTriple b c1 =
    -- Reject overlongs (E0 80..9F) and surrogates (ED A0..BF).
    not (b == 0xE0 && c1 < 0xA0) && not (b == 0xED && c1 >= 0xA0)


lead3 : Int -> Int -> Int -> Int
lead3 b c1 c2 =
    Bitwise.or
        (Bitwise.or (Bitwise.shiftLeftBy 12 (Bitwise.and 0x0F b)) (Bitwise.shiftLeftBy 6 (Bitwise.and 0x3F c1)))
        (Bitwise.and 0x3F c2)


validQuad : Int -> Int -> Bool
validQuad b c1 =
    -- Reject overlongs (F0 80..8F) and past-U+10FFFF (F4 90..BF).
    not (b == 0xF0 && c1 < 0x90) && not (b == 0xF4 && c1 > 0x8F)


lead4 : Int -> Int -> Int -> Int -> Int
lead4 b c1 c2 c3 =
    Bitwise.or
        (Bitwise.or
            (Bitwise.shiftLeftBy 18 (Bitwise.and 0x07 b))
            (Bitwise.shiftLeftBy 12 (Bitwise.and 0x3F c1))
        )
        (Bitwise.or (Bitwise.shiftLeftBy 6 (Bitwise.and 0x3F c2)) (Bitwise.and 0x3F c3))


{-| The eight pairs the live auditor grades (mirroring
`CONTRAST_PAIRS`): body/secondary text need AA 4.5, metadata and UI
accents need 3:1. -}
contrastPairs : List ContrastPair
contrastPairs =
    [ { label = "Body text", fg = "--paper", bg = "--ink", min = 4.5 }
    , { label = "Secondary text", fg = "--paper-dim", bg = "--ink", min = 4.5 }
    , { label = "Metadata", fg = "--paper-mute", bg = "--ink", min = 3 }
    , { label = "Text on panel", fg = "--paper", bg = "--stone-2", min = 4.5 }
    , { label = "Links / accent", fg = "--lapis-bright", bg = "--ink", min = 3 }
    , { label = "Gold accent", fg = "--gold-bright", bg = "--ink", min = 3 }
    , { label = "Status OK", fg = "--ok", bg = "--ink", min = 3 }
    , { label = "Danger", fg = "--shu-bright", bg = "--ink", min = 3 }
    ]


{-| One graded audit row. `ratio` is `Nothing` when a side cannot be
resolved (the oracle's `n/a` badge — e.g. a `color-mix` override the
browser would compute live but Elm resolves purely). -}
type alias AuditRow =
    { label : String
    , fg : String
    , bg : String
    , ratio : Maybe Float
    , level : Maybe String
    }


{-| Grade every pair against a resolved token map (base overlaid with
overrides), mirroring `ContrastAudit` minus the live-DOM read. Like
the oracle's `readLiveVar`, each side starts from the property's
*value* in the map, then resolves `var()` chains. -}
auditContrast : Dict String String -> List AuditRow
auditContrast tokens =
    List.map
        (\pair ->
            case ( resolvePairSide tokens pair.fg, resolvePairSide tokens pair.bg ) of
                ( Just fgRgb, Just bgRgb ) ->
                    let
                        raw =
                            Theme.contrastRatio fgRgb bgRgb

                        ratio =
                            toFloat (round (raw * 100)) / 100
                    in
                    { label = pair.label
                    , fg = pair.fg
                    , bg = pair.bg
                    , ratio = Just ratio
                    , level = Just (wcagLevel ratio)
                    }

                _ ->
                    { label = pair.label
                    , fg = pair.fg
                    , bg = pair.bg
                    , ratio = Nothing
                    , level = Nothing
                    }
        )
        contrastPairs


{-| Best label a ratio earns (mirroring `wcagRating` levels). -}
wcagLevel : Float -> String
wcagLevel ratio =
    if ratio >= 7 then
        "AAA"

    else if ratio >= 4.5 then
        "AA"

    else if ratio >= 3 then
        "AA Large"

    else
        "Fail"


{-| Badge class suffix for a level (`aa-large` for "AA Large"). -}
auditBadgeClass : String -> String
auditBadgeClass level =
    String.toLower level |> String.replace " " "-"


{-| Count rows below their WCAG floor (unresolvable rows never count). -}
auditFailing : Dict String String -> List AuditRow -> Int
auditFailing tokens rows =
    List.filter
        (\row ->
            case row.ratio of
                Just ratio ->
                    case List.filter (\pair -> pair.label == row.label) contrastPairs |> List.head of
                        Just pair ->
                            ratio < pair.min

                        Nothing ->
                            False

                Nothing ->
                    False
        )
        rows
        |> List.length


{-| Resolve one audit side: the property's value, then `var()` chains. -}
resolvePairSide : Dict String String -> String -> Maybe Theme.Rgb
resolvePairSide tokens property =
    Dict.get property tokens
        |> Maybe.andThen (\value -> resolveTokenColor tokens value 0)


{-| Resolve a token value to RGB: `var(--x)` chains (depth ≤ 8),
hex, `rgb()`, `oklch()`, and the opaque named colors. Anything
else (`color-mix`, `transparent`, unknown) stays unresolved.
-}
resolveTokenColor : Dict String String -> String -> Int -> Maybe Theme.Rgb
resolveTokenColor tokens value depth =
    if depth < 8 then
        case varRefRegex of
            Just re ->
                case Regex.find re (String.trim value) of
                    [ match ] ->
                        case match.submatches of
                            [ Just name ] ->
                                case Dict.get name tokens of
                                    Just target ->
                                        resolveTokenColor tokens target (depth + 1)

                                    Nothing ->
                                        Nothing

                            _ ->
                                parsePlainColor value

                    _ ->
                        parsePlainColor value

            Nothing ->
                Nothing

    else
        Nothing


parsePlainColor : String -> Maybe Theme.Rgb
parsePlainColor value =
    let
        trimmed =
            String.trim value
    in
    case Theme.parseHex trimmed of
        Just rgb ->
            Just rgb

        Nothing ->
            case parseRgbFunction trimmed of
                Just rgb ->
                    Just rgb

                Nothing ->
                    case parseOklchFunction trimmed of
                        Just rgb ->
                            Just rgb

                        Nothing ->
                            case String.toLower trimmed of
                                "black" ->
                                    Just { r = 0, g = 0, b = 0 }

                                "white" ->
                                    Just { r = 255, g = 255, b = 255 }

                                _ ->
                                    Nothing


parseRgbFunction : String -> Maybe Theme.Rgb
parseRgbFunction value =
    case rgbFunctionRegex of
        Just re ->
            case Regex.find re value of
                [ match ] ->
                    case List.filterMap identity match.submatches of
                        [ rStr, gStr, bStr ] ->
                            case ( ( String.toFloat rStr, String.toFloat gStr ), String.toFloat bStr ) of
                                ( ( Just r, Just g ), Just b ) ->
                                    let
                                        ri =
                                            round r

                                        gi =
                                            round g

                                        bi =
                                            round b
                                    in
                                    if ri >= 0 && ri <= 255 && gi >= 0 && gi <= 255 && bi >= 0 && bi <= 255 then
                                        Just { r = ri, g = gi, b = bi }

                                    else
                                        Nothing

                                _ ->
                                    Nothing

                        _ ->
                            Nothing

                _ ->
                    Nothing

        Nothing ->
            Nothing


rgbFunctionRegex : Maybe Regex.Regex
rgbFunctionRegex =
    Regex.fromStringWith { caseInsensitive = True, multiline = False }
        ("^rgba?\\(\\s*("
            ++ cssNumberPattern
            ++ ")[\\s,]+("
            ++ cssNumberPattern
            ++ ")[\\s,]+("
            ++ cssNumberPattern
            ++ ")"
        )


parseOklchFunction : String -> Maybe Theme.Rgb
parseOklchFunction value =
    case oklchRegex of
        Just re ->
            case Regex.find re (String.toLower value) of
                [ match ] ->
                    case checkOklchParts match.submatches of
                        True ->
                            oklchPartsToRgb match.submatches

                        False ->
                            Nothing

                _ ->
                    Nothing

        Nothing ->
            Nothing


oklchPartsToRgb : List (Maybe String) -> Maybe Theme.Rgb
oklchPartsToRgb parts =
    case parts of
        [ Just lStr, pctL, Just cStr, Just hStr, alphaStr, _ ] ->
            case ( ( String.toFloat lStr, String.toFloat cStr ), String.toFloat hStr ) of
                ( ( Just l, Just c ), Just h ) ->
                    let
                        lightness =
                            if pctL == Nothing then
                                l

                            else
                                l / 100

                        _ =
                            alphaStr
                    in
                    Just (Theme.oklchToRgb { l = lightness, c = c, h = h })

                _ ->
                    Nothing

        _ ->
            Nothing


{-| The Adjust panel's transform state — identity means "no change". -}
type alias AdjustState =
    { hueShift : Float
    , saturation : Float
    , warmth : Float
    , contrast : Float
    }


adjustIdentity : AdjustState
adjustIdentity =
    { hueShift = 0, saturation = 1, warmth = 0, contrast = 0 }


isAdjustIdentity : AdjustState -> Bool
isAdjustIdentity adjust =
    adjust == adjustIdentity


{-| Replace the whole override set with `map`, dropping entries equal
to the base value (mirroring `setAllOverrides` minus the DOM write,
which rides the apply outbound). -}
diffOverrides : Dict String String -> Dict String String -> Dict String String
diffOverrides baseTokens map =
    Dict.filter (\prop val -> Dict.get prop baseTokens /= Just val) map


{-| Signed two-decimal knob readout (`+1.20` / `-0.35`). -}
fmtSigned : Float -> String
fmtSigned v =
    (if v >= 0 then
        "+"

     else
        ""
    )
        ++ formatFixed2 v


{-| Two-decimal readout (`1.20`, `8.00`). -}
formatFixed2 : Float -> String
formatFixed2 v =
    let
        sign =
            if v < 0 then
                "-"

            else
                ""

        scaled =
            round (abs v * 100)

        whole =
            scaled // 100

        frac =
            modBy 100 scaled

        fracText =
            if frac < 10 then
                "0" ++ String.fromInt frac

            else
                String.fromInt frac
    in
    sign ++ String.fromInt whole ++ "." ++ fracText


{-| Anchor saves/exports on a same-scheme built-in when the factory
generated across schemes (mirroring `schemeCorrectedBase`):
`light` → `pearl`, anything else → the first built-in (`ocean`).
`schemeOf` maps a base id to its scheme (`Nothing` = unknown).
-}
schemeCorrectedBase : (String -> Maybe String) -> String -> Maybe String -> String
schemeCorrectedBase schemeOf base override =
    case override of
        Nothing ->
            base

        Just target ->
            if schemeOf base == Just target then
                base

            else if target == "light" then
                "pearl"

            else
                "ocean"


{-| Suggested save name (mirroring `beginSave`): the custom theme's
own name when editing one, else `<base label> custom`. Callers pass
the already-resolved names (`My theme` / `My` fallbacks applied).
-}
saveSuggestion : Bool -> String -> String -> String
saveSuggestion isCustom customName builtinLabel =
    if isCustom then
        customName

    else
        builtinLabel ++ " custom"


{-| Fold saved + session overrides for save/export (mirroring the
`{ ...baseOverrides, ...overrides() }` merge). -}
mergeSaveOverrides : Dict String String -> Dict String String -> Dict String String
mergeSaveOverrides baseOverrides session =
    Dict.union session baseOverrides


{-| Representative accent swatches sourced from the engine's own
`--lapis` / `--gold` output (mirroring `seedSwatches`). -}
seedSwatches : Theme.PaletteSeed -> { primary : String, accent : String }
seedSwatches seed =
    let
        palette =
            Theme.generatePalette seed
    in
    { primary = Dict.get "--lapis" palette |> Maybe.withDefault "#000000"
    , accent = Dict.get "--gold" palette |> Maybe.withDefault "#000000"
    }


{-| Classify an eye-dropper / color-input hex for the accent seed
(mirroring `sampledAccentSeed`): strict 6-digit hex, hue rounded. -}
sampledAccentSeed : String -> Maybe { hex : String, hue : Float }
sampledAccentSeed value =
    if String.length value /= 7 then
        Nothing

    else
        case sampledHexRegex of
            Just re ->
                if Regex.contains re value then
                    let
                        hex =
                            String.toLower value
                    in
                    case Theme.hexToOklch hex of
                        Just color ->
                            Just { hex = hex, hue = toFloat (round color.h) }

                        Nothing ->
                            Nothing

                else
                    Nothing

            Nothing ->
                Nothing


sampledHexRegex : Maybe Regex.Regex
sampledHexRegex =
    Regex.fromStringWith { caseInsensitive = True, multiline = False }
        "^#[0-9a-f]{6}$"
