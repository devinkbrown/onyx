module Prefs exposing
    ( Clock(..)
    , Density(..)
    , ExperienceMode(..)
    , FontScale(..)
    , Preferences
    , ReactionDensity(..)
    , SceneMotion(..)
    , Width(..)
    , clockFromString
    , clockToString
    , clocks
    , decodePreferences
    , defaultPreferences
    , densities
    , densityFromString
    , densityToString
    , encodePreferences
    , experienceModeFromString
    , experienceModeToString
    , fontScaleFromString
    , fontScaleToString
    , fontScales
    , formatBlockedHosts
    , maxBlockedHostChars
    , maxBlockedHosts
    , maxPreferencesStorageChars
    , parseBlockedHosts
    , parseSceneMotion
    , preferencesStorageKey
    , reactionDensityFromString
    , reactionDensityToString
    , sanitizeBlockedHost
    , sceneMotionStorageKey
    , sceneMotionToString
    , sceneMotions
    , updatePreference
    , widthFromString
    , widthToString
    )

{-| Display & behaviour preferences (1:1 with
`src/lib/prefs/preferences.ts` + `src/lib/prefs/sceneMotion.ts`).

The only way these settings reach the UI is through `data-*`
attributes on `document.documentElement` (applied ports-side); the
message components stay untouched. Storage lives under the `onyx:`
keys, validated per field with defaults for anything bad.

-}

import Json.Decode as Decode
import Json.Encode as Encode


preferencesStorageKey : String
preferencesStorageKey =
    "onyx:preferences"


sceneMotionStorageKey : String
sceneMotionStorageKey =
    "onyx:scene-motion"


legacyHighContrastKey : String
legacyHighContrastKey =
    "onyx:high-contrast"


{-| Fixed-schema preferences are tiny; reject quota-sized storage
before parsing.
-}
maxPreferencesStorageChars : Int
maxPreferencesStorageChars =
    16 * 1024


maxBlockedHosts : Int
maxBlockedHosts =
    32


maxBlockedHostChars : Int
maxBlockedHostChars =
    253


type Density
    = DensityCompact
    | DensityCozy
    | DensityRoomy


type FontScale
    = FontSmall
    | FontMedium
    | FontLarge


type Width
    = WidthMeasured
    | WidthFull


type Clock
    = Clock24h
    | Clock12h


type ReactionDensity
    = ReactionFull
    | ReactionCompact
    | ReactionCountsOnly
    | ReactionHidden


type ExperienceMode
    = ExperienceStandard
    | ExperienceAdvanced
    | ExperienceNetworkOps


type SceneMotion
    = SceneAdaptive
    | SceneAnimated
    | SceneStill
    | SceneOff


densities : List Density
densities =
    [ DensityCompact, DensityCozy, DensityRoomy ]


fontScales : List FontScale
fontScales =
    [ FontSmall, FontMedium, FontLarge ]


clocks : List Clock
clocks =
    [ Clock24h, Clock12h ]


sceneMotions : List SceneMotion
sceneMotions =
    [ SceneAdaptive, SceneAnimated, SceneStill, SceneOff ]


densityToString : Density -> String
densityToString density =
    case density of
        DensityCompact ->
            "compact"

        DensityCozy ->
            "cozy"

        DensityRoomy ->
            "roomy"


densityFromString : String -> Maybe Density
densityFromString raw =
    case raw of
        "compact" ->
            Just DensityCompact

        "cozy" ->
            Just DensityCozy

        "roomy" ->
            Just DensityRoomy

        _ ->
            Nothing


fontScaleToString : FontScale -> String
fontScaleToString scale =
    case scale of
        FontSmall ->
            "sm"

        FontMedium ->
            "md"

        FontLarge ->
            "lg"


fontScaleFromString : String -> Maybe FontScale
fontScaleFromString raw =
    case raw of
        "sm" ->
            Just FontSmall

        "md" ->
            Just FontMedium

        "lg" ->
            Just FontLarge

        _ ->
            Nothing


widthToString : Width -> String
widthToString width =
    case width of
        WidthMeasured ->
            "measured"

        WidthFull ->
            "full"


widthFromString : String -> Maybe Width
widthFromString raw =
    case raw of
        "measured" ->
            Just WidthMeasured

        "full" ->
            Just WidthFull

        _ ->
            Nothing


clockToString : Clock -> String
clockToString clock =
    case clock of
        Clock24h ->
            "24h"

        Clock12h ->
            "12h"


clockFromString : String -> Maybe Clock
clockFromString raw =
    case raw of
        "24h" ->
            Just Clock24h

        "12h" ->
            Just Clock12h

        _ ->
            Nothing


reactionDensityToString : ReactionDensity -> String
reactionDensityToString density =
    case density of
        ReactionFull ->
            "full"

        ReactionCompact ->
            "compact"

        ReactionCountsOnly ->
            "counts-only"

        ReactionHidden ->
            "hidden"


reactionDensityFromString : String -> Maybe ReactionDensity
reactionDensityFromString raw =
    case raw of
        "full" ->
            Just ReactionFull

        "compact" ->
            Just ReactionCompact

        "counts-only" ->
            Just ReactionCountsOnly

        "hidden" ->
            Just ReactionHidden

        _ ->
            Nothing


experienceModeToString : ExperienceMode -> String
experienceModeToString mode =
    case mode of
        ExperienceStandard ->
            "standard"

        ExperienceAdvanced ->
            "advanced"

        ExperienceNetworkOps ->
            "network-ops"


experienceModeFromString : String -> Maybe ExperienceMode
experienceModeFromString raw =
    case raw of
        -- Legacy storage id migrates forward.
        "irc-ops" ->
            Just ExperienceNetworkOps

        "standard" ->
            Just ExperienceStandard

        "advanced" ->
            Just ExperienceAdvanced

        "network-ops" ->
            Just ExperienceNetworkOps

        _ ->
            Nothing


sceneMotionToString : SceneMotion -> String
sceneMotionToString motion =
    case motion of
        SceneAdaptive ->
            "adaptive"

        SceneAnimated ->
            "animated"

        SceneStill ->
            "still"

        SceneOff ->
            "off"


parseSceneMotion : String -> Maybe SceneMotion
parseSceneMotion raw =
    case raw of
        "adaptive" ->
            Just SceneAdaptive

        "animated" ->
            Just SceneAnimated

        "still" ->
            Just SceneStill

        "off" ->
            Just SceneOff

        _ ->
            Nothing


type alias Preferences =
    { density : Density
    , fontScale : FontScale
    , hideEvents : Bool
    , width : Width
    , readerMode : Bool
    , reduceMotion : Bool
    , reduceTransparency : Bool
    , highContrast : Bool
    , linkPreviews : Bool
    , httpsOnly : Bool
    , blockedHosts : List String
    , clock : Clock
    , localHistory : Bool
    , e2eeDms : Bool
    , timeScrubber : Bool
    , voiceEntry : Bool
    , topicTools : Bool
    , watchTogether : Bool
    , reactionDensity : ReactionDensity
    , experienceMode : ExperienceMode
    }


defaultPreferences : Preferences
defaultPreferences =
    { density = DensityCozy
    , fontScale = FontMedium
    , hideEvents = False
    , width = WidthMeasured
    , readerMode = False
    , reduceMotion = False
    , reduceTransparency = False
    , highContrast = False
    , linkPreviews = True
    , httpsOnly = True
    , blockedHosts = []
    , clock = Clock24h
    , localHistory = True
    , e2eeDms = True
    , timeScrubber = False
    , voiceEntry = True
    , topicTools = True
    , watchTogether = False
    , reactionDensity = ReactionFull
    , experienceMode = ExperienceStandard
    }


boolField : String -> Decode.Value -> Bool -> Bool
boolField name raw fallback =
    case Decode.decodeValue (Decode.field name Decode.bool) raw of
        Ok value ->
            value

        Err _ ->
            fallback


stringField : String -> Decode.Value -> Maybe String
stringField name raw =
    Decode.decodeValue (Decode.field name Decode.string) raw
        |> Result.toMaybe


{-| Sanitize a free-form host blocklist entry. Rejects schemes,
paths, spaces, credentials, and oversized labels. Returns the
lowercase hostname or `Nothing`.
-}
sanitizeBlockedHost : String -> Maybe String
sanitizeBlockedHost raw =
    let
        host =
            raw |> String.trim |> String.toLower |> stripDots
    in
    if String.isEmpty host || String.length host > maxBlockedHostChars then
        Nothing

    else if String.any (\c -> c == '/' || c == ':' || c == '@' || c == '?' || c == '#' || c == ' ' || c == '\t' || c == '\n' || c == '\u{000D}') host then
        Nothing

    else if host == "localhost" || isHostname host then
        Just host

    else
        Nothing


stripDots : String -> String
stripDots host =
    let
        dropLeading s =
            if String.startsWith "." s then
                dropLeading (String.dropLeft 1 s)

            else
                s

        dropTrailing s =
            if String.endsWith "." s then
                dropTrailing (String.dropRight 1 s)

            else
                s
    in
    dropTrailing (dropLeading host)


isHostname : String -> Bool
isHostname host =
    List.all isHostnameLabel (String.split "." host)
        && not (List.isEmpty (String.split "." host))


isHostnameLabel : String -> Bool
isHostnameLabel label =
    let
        chars =
            String.toList label
    in
    case ( List.head chars, List.head (List.reverse chars) ) of
        ( Just first, Just last ) ->
            isLowerAlnum first
                && isLowerAlnum last
                && List.all (\c -> isLowerAlnum c || c == '-') chars

        _ ->
            False


isLowerAlnum : Char -> Bool
isLowerAlnum c =
    (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')


{-| Parse a stored or free-form list of blocked host suffixes. Fail
closed: strings split on commas, anything else reads empty; bad
entries drop, duplicates collapse, capped at 32.
-}
parseBlockedHosts : Decode.Value -> List String
parseBlockedHosts raw =
    let
        items =
            case Decode.decodeValue (Decode.list Decode.string) raw of
                Ok entries ->
                    entries

                Err _ ->
                    case Decode.decodeValue Decode.string raw of
                        Ok text ->
                            String.split "," text

                        Err _ ->
                            []
    in
    List.foldl
        (\item kept ->
            case sanitizeBlockedHost item of
                Just host ->
                    if List.member host kept || List.length kept >= maxBlockedHosts then
                        kept

                    else
                        kept ++ [ host ]

                Nothing ->
                    kept
        )
        []
        items


{-| Format blocked hosts for a comma-separated preference field.
-}
formatBlockedHosts : List String -> String
formatBlockedHosts hosts =
    String.join ", " hosts


{-| Validate one stored preferences record, falling back to defaults
for any bad field (mirroring `preferencesFromRecord`).
-}
preferencesFromValue : Decode.Value -> Preferences
preferencesFromValue raw =
    let
        defaults =
            defaultPreferences

        blockedHosts =
            case Decode.decodeValue (Decode.field "blockedHosts" Decode.value) raw of
                Ok value ->
                    parseBlockedHosts value

                Err _ ->
                    defaults.blockedHosts
    in
    { density = stringField "density" raw |> Maybe.andThen densityFromString |> Maybe.withDefault defaults.density
    , fontScale = stringField "fontScale" raw |> Maybe.andThen fontScaleFromString |> Maybe.withDefault defaults.fontScale
    , hideEvents = boolField "hideEvents" raw defaults.hideEvents
    , width = stringField "width" raw |> Maybe.andThen widthFromString |> Maybe.withDefault defaults.width
    , readerMode = boolField "readerMode" raw defaults.readerMode
    , reduceMotion = boolField "reduceMotion" raw defaults.reduceMotion
    , reduceTransparency = boolField "reduceTransparency" raw defaults.reduceTransparency
    , highContrast = boolField "highContrast" raw defaults.highContrast
    , linkPreviews = boolField "linkPreviews" raw defaults.linkPreviews
    , httpsOnly = boolField "httpsOnly" raw defaults.httpsOnly
    , blockedHosts = blockedHosts
    , clock = stringField "clock" raw |> Maybe.andThen clockFromString |> Maybe.withDefault defaults.clock
    , localHistory = boolField "localHistory" raw defaults.localHistory
    , e2eeDms = boolField "e2eeDms" raw defaults.e2eeDms
    , timeScrubber = boolField "timeScrubber" raw defaults.timeScrubber
    , voiceEntry = boolField "voiceEntry" raw defaults.voiceEntry
    , topicTools = boolField "topicTools" raw defaults.topicTools
    , watchTogether = boolField "watchTogether" raw defaults.watchTogether
    , reactionDensity = stringField "reactionDensity" raw |> Maybe.andThen reactionDensityFromString |> Maybe.withDefault defaults.reactionDensity
    , experienceMode = stringField "experienceMode" raw |> Maybe.andThen experienceModeFromString |> Maybe.withDefault defaults.experienceMode
    }


{-| Parse a stored snapshot: non-objects read absent; the legacy
high-contrast flag fills in only when the record carries no boolean
of its own (mirroring `loadPreferences`).
-}
decodePreferences : String -> Maybe String -> Preferences
decodePreferences body legacyHighContrast =
    let
        parsed =
            case Decode.decodeString Decode.value body of
                Ok value ->
                    case Decode.decodeValue (Decode.keyValuePairs Decode.value) value of
                        Ok _ ->
                            Just (preferencesFromValue value)

                        Err _ ->
                            -- A parsed non-object still validates field-wise
                            -- (arrays read all-defaults); only a JSON syntax
                            -- failure returns before the legacy migration.
                            Just defaultPreferences

                Err _ ->
                    Nothing
    in
    case parsed of
        Nothing ->
            defaultPreferences

        Just prefs ->
            case legacyHighContrast of
                Just "1" ->
                    if hasHighContrastField body then
                        prefs

                    else
                        { prefs | highContrast = True }

                _ ->
                    prefs


hasHighContrastField : String -> Bool
hasHighContrastField body =
    case Decode.decodeString (Decode.field "highContrast" Decode.bool) body of
        Ok _ ->
            True

        Err _ ->
            False


{-| Encode preferences for the `onyx:preferences` slot.
-}
encodePreferences : Preferences -> String
encodePreferences prefs =
    Encode.encode 0
        (Encode.object
            [ ( "density", Encode.string (densityToString prefs.density) )
            , ( "fontScale", Encode.string (fontScaleToString prefs.fontScale) )
            , ( "hideEvents", Encode.bool prefs.hideEvents )
            , ( "width", Encode.string (widthToString prefs.width) )
            , ( "readerMode", Encode.bool prefs.readerMode )
            , ( "reduceMotion", Encode.bool prefs.reduceMotion )
            , ( "reduceTransparency", Encode.bool prefs.reduceTransparency )
            , ( "highContrast", Encode.bool prefs.highContrast )
            , ( "linkPreviews", Encode.bool prefs.linkPreviews )
            , ( "httpsOnly", Encode.bool prefs.httpsOnly )
            , ( "blockedHosts", Encode.list Encode.string prefs.blockedHosts )
            , ( "clock", Encode.string (clockToString prefs.clock) )
            , ( "localHistory", Encode.bool prefs.localHistory )
            , ( "e2eeDms", Encode.bool prefs.e2eeDms )
            , ( "timeScrubber", Encode.bool prefs.timeScrubber )
            , ( "voiceEntry", Encode.bool prefs.voiceEntry )
            , ( "topicTools", Encode.bool prefs.topicTools )
            , ( "watchTogether", Encode.bool prefs.watchTogether )
            , ( "reactionDensity", Encode.string (reactionDensityToString prefs.reactionDensity) )
            , ( "experienceMode", Encode.string (experienceModeToString prefs.experienceMode) )
            ]
        )


{-| Set one appearance-page preference key (the page only edits
`fontScale`, `density`, and `reduceMotion`; the rest rides along so a
save never drops fields).
-}
updatePreference : Preferences -> String -> String -> Preferences
updatePreference prefs key value =
    case key of
        "fontScale" ->
            { prefs | fontScale = fontScaleFromString value |> Maybe.withDefault prefs.fontScale }

        "density" ->
            { prefs | density = densityFromString value |> Maybe.withDefault prefs.density }

        "reduceMotion" ->
            { prefs | reduceMotion = value == "true" }

        _ ->
            prefs
