module ThemeLook exposing
    ( BackgroundKind(..)
    , BackgroundOption
    , CustomThemeRef
    , LookEntry
    , ThemeMeta
    , autoBackgroundId
    , backgroundGroups
    , backgroundOptions
    , buildDefaultLookEntries
    , customThemeStorageKey
    , decodeCustomThemeRefs
    , defaultThemeId
    , fallbackBackgroundId
    , isCustomThemeId
    , isPublicThemeId
    , normalizeThemeId
    , publicThemeIds
    , publicThemeLabels
    , resolveBackgroundId
    , swatchFromTokens
    , themeIds
    , themeMeta
    , themeStorageKey
    )

{-| Theme-look registry for the Appearance page (1:1 with
`src/theme/themes.ts` meta, `src/theme/publicLooks.ts`,
`src/theme/themeStorage.ts` legacy remaps, `src/theme/customThemes.ts`
identity, `src/shell/themeBackground.ts`, and the
`src/backgrounds/catalogue.ts` picker options).

Only look-level metadata lives here (id, label, description, scheme,
signature background, swatch triple). Full token maps stay with the
`Theme` palette factory and the ThemeStudio slice; custom-theme chips
reuse the static oracle swatch.

-}

import Json.Decode as JsonDecode


themeStorageKey : String
themeStorageKey =
    "onyx:theme"


customThemeStorageKey : String
customThemeStorageKey =
    "onyx:custom-themes"


defaultThemeId : String
defaultThemeId =
    "ocean"


{-| Sentinel background id meaning "follow the active theme's
signature".
-}
autoBackgroundId : String
autoBackgroundId =
    "auto"


{-| Fallback when a theme somehow declares no signature background.
-}
fallbackBackgroundId : String
fallbackBackgroundId =
    "deep-current"


publicThemeIds : List String
publicThemeIds =
    [ "ocean", "pearl" ]


publicThemeLabels : List ( String, String )
publicThemeLabels =
    [ ( "ocean", "Ocean · Dark" ), ( "pearl", "Pearl · Light" ) ]


isPublicThemeId : String -> Bool
isPublicThemeId id =
    List.member id publicThemeIds


isCustomThemeId : String -> Bool
isCustomThemeId id =
    String.startsWith "custom:" id


type alias ThemeMeta =
    { id : String
    , label : String
    , description : String
    , scheme : String
    , signatureBg : String
    , swatch : List String
    }


themeMeta : List ThemeMeta
themeMeta =
    [ { id = "ocean", label = "Ocean", description = "The flagship — mineral night, quiet cyan signal, and matte, focused surfaces.", scheme = "dark", signatureBg = "deep-current", swatch = [ "#65adf5", "#b4bfca", "#343b43" ] }
    , { id = "tide", label = "Ocean · Tide", description = "Shallow sunlit water — lifted azure surfaces, a more luminous crest, pale sand-cyan shallows.", scheme = "dark", signatureBg = "caustics", swatch = [ "#00b8ed", "#5dcbd1", "#12262e" ] }
    , { id = "abyss", label = "Ocean · Abyss", description = "The deep trench — near-black water, restrained azure that glows, high-contrast sea-foam.", scheme = "dark", signatureBg = "bioluminescence", swatch = [ "#0091cb", "#51a0ad", "#050c10" ] }
    , { id = "reef", label = "Ocean · Reef", description = "Living reef — azure current warmed by living coral. A touch more colour.", scheme = "dark", signatureBg = "caustics", swatch = [ "#0094bc", "#f19173", "#081a21" ] }
    , { id = "onyx", label = "Onyx", description = "Black banded stone, gold inlay, moonstone sheen — the older cut.", scheme = "dark", signatureBg = "gold-veins", swatch = [ "#6996c5", "#c9a24a", "#0d0f12" ] }
    , { id = "obsidian", label = "Obsidian", description = "Pure AMOLED black, cool steel sheen. The deepest cut of the stone.", scheme = "dark", signatureBg = "bioluminescence", swatch = [ "#6a9eca", "#7fa5b8", "#07090a" ] }
    , { id = "pearl", label = "Pearl", description = "The light cut — warm paper, ink text, gold inlay.", scheme = "light", signatureBg = "paper-grain", swatch = [ "#0065b0", "#896100", "#dbd6cc" ] }
    , { id = "ink", label = "Ink", description = "Monochrome brushwork — bone-white on the deepest black, one red seal.", scheme = "dark", signatureBg = "ink-wash", swatch = [ "#c9c3bc", "#bbb7b1", "#08090c" ] }
    , { id = "shu", label = "Garnet", description = "Garnet-forward dark — crimson current over warm maroon ground, ember second.", scheme = "dark", signatureBg = "ember", swatch = [ "#e74142", "#f4733c", "#21100d" ] }
    , { id = "hisui", label = "Jade", description = "Jade green. Deep forest ground, pale-jade mineral second.", scheme = "dark", signatureBg = "forest", swatch = [ "#00a149", "#70c5a0", "#0c190f" ] }
    , { id = "pine", label = "Pine", description = "Deep old-growth pine — cool coniferous canopy over umber forest floor, mossy lichen second.", scheme = "dark", signatureBg = "mist", swatch = [ "#3b9f32", "#a5a51a", "#0e170d" ] }
    , { id = "kohaku", label = "Amber", description = "Amber resin. Warm amber current, honey second.", scheme = "dark", signatureBg = "resin", swatch = [ "#d98b09", "#eea563", "#1d1507" ] }
    , { id = "terracotta", label = "Terracotta", description = "Warm editorial earthenware — burnt-clay orange over fired umber, dusty blush second.", scheme = "dark", signatureBg = "volcanic", swatch = [ "#d55c27", "#e8777a", "#1f130c" ] }
    , { id = "vermillion", label = "Vermillion", description = "Ink & Vermillion — the house seal: a single vermillion accent over the deepest warm ink.", scheme = "dark", signatureBg = "ember", swatch = [ "#de5034", "#ef7179", "#1d0f0b" ] }
    , { id = "sapphire", label = "Sapphire", description = "A single deep royal-blue jewel — indigo-navy ground, periwinkle current, cut monochrome.", scheme = "dark", signatureBg = "bioluminescence", swatch = [ "#0089ea", "#00aaf3", "#071420" ] }
    , { id = "teal", label = "Teal", description = "Deep teal ground, seafoam text, mint current, and seafoam marks.", scheme = "dark", signatureBg = "deep-current", swatch = [ "#009d82", "#72ccab", "#071914" ] }
    , { id = "slate", label = "Slate", description = "Warm graphite, chalk text, quiet mineral seams, and muted bronze marks.", scheme = "dark", signatureBg = "mist", swatch = [ "#949d7b", "#ae7853", "#1c1a15" ] }
    , { id = "frost", label = "Frost", description = "Cool frost paper, deep slate ink, steel-blue current, and pale steel linework.", scheme = "light", signatureBg = "frost", swatch = [ "#036884", "#00768a", "#c3d7dd" ] }
    ]


themeIds : List String
themeIds =
    List.map .id themeMeta


themeById : String -> Maybe ThemeMeta
themeById id =
    List.filter (\meta -> meta.id == id) themeMeta |> List.head


{-| Three-color chip from a token map (mirroring `swatchFromTokens`).
-}
swatchFromTokens : List ( String, String ) -> List String
swatchFromTokens tokens =
    let
        get key fallback =
            List.filter (\( k, _ ) -> k == key) tokens
                |> List.head
                |> Maybe.map Tuple.second
                |> Maybe.withDefault fallback
    in
    [ get "--lapis" (get "--accent" "#2bb4f0")
    , get "--gold" "#d8b96a"
    , get "--stone-2" (get "--bg-raised" "#0f2740")
    ]


{-| English-only remaps for retired aliases (mirroring
`LEGACY_THEME_MAP` — no non-English brands).
-}
legacyThemeMap : List ( String, String )
legacyThemeMap =
    [ ( "lacquer", "shu" )
    , ( "midnight", "ocean" )
    , ( "amoled", "abyss" )
    , ( "light", "pearl" )
    , ( "ash", "slate" )
    , ( "bathyal", "abyss" )
    , ( "coral", "shu" )
    , ( "kelp", "hisui" )
    , ( "brine", "teal" )
    , ( "arctic", "frost" )
    , ( "system", "ocean" )
    ]


type alias CustomThemeRef =
    { id : String
    , name : String
    , base : String
    }


{-| Normalize a stored theme id: legacy aliases remap, unknown ids
(and unknown custom ids) read absent so the caller falls back to the
default (mirroring `normalizeThemeId`).
-}
normalizeThemeId : String -> List CustomThemeRef -> Maybe String
normalizeThemeId raw customs =
    if String.isEmpty raw then
        Nothing

    else
        let
            mapped =
                List.filter (\( from, _ ) -> from == raw) legacyThemeMap
                    |> List.head
                    |> Maybe.map Tuple.second
                    |> Maybe.withDefault raw
        in
        if themeById mapped /= Nothing then
            Just mapped

        else if isCustomThemeId mapped && List.any (\custom -> custom.id == mapped) customs then
            Just mapped

        else
            Nothing


{-| Decode the `onyx:custom-themes` slot into chip references. Only
entries with a `custom:` id, a non-empty name, and a known built-in
base survive (fail-closed; overrides are the ThemeStudio slice's
concern).
-}
decodeCustomThemeRefs : String -> List CustomThemeRef
decodeCustomThemeRefs body =
    case JsonDecode.decodeString (JsonDecode.list JsonDecode.value) body of
        Err _ ->
            []

        Ok entries ->
            List.filterMap decodeCustomThemeRef (List.take 64 entries)


decodeCustomThemeRef : JsonDecode.Value -> Maybe CustomThemeRef
decodeCustomThemeRef raw =
    let
        field name =
            JsonDecode.decodeValue (JsonDecode.field name JsonDecode.string) raw |> Result.toMaybe
    in
    case ( field "id", field "name", field "base" ) of
        ( Just id, Just name, Just base ) ->
            if isCustomThemeId id && not (String.isEmpty name) && themeById base /= Nothing then
                Just { id = id, name = name, base = base }

            else
                Nothing

        _ ->
            Nothing


type alias LookEntry =
    { id : String
    , label : String
    , title : String
    , swatch : List String
    , extra : Bool
    }


builtinLook : ThemeMeta -> Bool -> LookEntry
builtinLook meta extra =
    { id = meta.id
    , label =
        if extra then
            meta.label

        else
            List.filter (\( id, _ ) -> id == meta.id) publicThemeLabels
                |> List.head
                |> Maybe.map Tuple.second
                |> Maybe.withDefault meta.label
    , title = meta.description
    , swatch = meta.swatch
    , extra = extra
    }


{-| Ocean / Pearl, plus the active look when it is outside that public
set (mirroring `buildDefaultLookEntries`).
-}
buildDefaultLookEntries : String -> List CustomThemeRef -> List LookEntry
buildDefaultLookEntries activeId customs =
    let
        looks =
            List.filterMap
                (\id ->
                    case themeById id of
                        Just meta ->
                            if List.member id publicThemeIds then
                                Just (builtinLook meta False)

                            else
                                Nothing

                        Nothing ->
                            Nothing
                )
                publicThemeIds
    in
    if List.any (\entry -> entry.id == activeId) looks then
        looks

    else
        case themeById activeId of
            Just meta ->
                looks ++ [ builtinLook meta True ]

            Nothing ->
                case List.filter (\custom -> custom.id == activeId) customs |> List.head of
                    Just custom ->
                        let
                            baseLabel =
                                themeById custom.base |> Maybe.map .label |> Maybe.withDefault custom.base
                        in
                        looks
                            ++ [ { id = custom.id
                                 , label = custom.name
                                 , title = "Saved look based on " ++ baseLabel
                                 , swatch = [ "var(--lapis)", "var(--gold)", "var(--shu)" ]
                                 , extra = True
                                 }
                               ]

                    Nothing ->
                        looks


type BackgroundKind
    = BackgroundAnimated
    | BackgroundSolid
    | BackgroundScene


type alias BackgroundOption =
    { id : String
    , label : String
    , kind : BackgroundKind
    , character : String
    , detail : String
    }


backgroundOptions : List BackgroundOption
backgroundOptions =
    [ { id = "deep-current", label = "Deep Current", kind = BackgroundAnimated, character = "cool tide", detail = "medium" }
    , { id = "bioluminescence", label = "Bioluminescence", kind = BackgroundAnimated, character = "blue bloom", detail = "high" }
    , { id = "caustics", label = "Caustic Tide", kind = BackgroundAnimated, character = "water light", detail = "medium" }
    , { id = "aurora", label = "Mineral Aurora", kind = BackgroundAnimated, character = "mineral glow", detail = "high" }
    , { id = "pyrite-field", label = "Pyrite Field", kind = BackgroundAnimated, character = "dark ore", detail = "medium" }
    , { id = "gold-veins", label = "Gold Veins", kind = BackgroundAnimated, character = "gold seam", detail = "medium" }
    , { id = "ember", label = "Ember", kind = BackgroundAnimated, character = "banked fire", detail = "medium" }
    , { id = "forest", label = "Grove", kind = BackgroundAnimated, character = "deep grove", detail = "medium" }
    , { id = "resin", label = "Resin", kind = BackgroundAnimated, character = "amber depth", detail = "low" }
    , { id = "ink-wash", label = "Ink wash", kind = BackgroundAnimated, character = "soft ink", detail = "low" }
    , { id = "mist", label = "Mist", kind = BackgroundAnimated, character = "quiet haze", detail = "low" }
    , { id = "frost", label = "Frost", kind = BackgroundAnimated, character = "cold grain", detail = "low" }
    , { id = "aurora-ribbons", label = "Aurora Ribbons", kind = BackgroundAnimated, character = "ribbon light", detail = "high" }
    , { id = "tide-bands", label = "Tide Bands", kind = BackgroundAnimated, character = "tidal bands", detail = "low" }
    , { id = "obsidian", label = "Obsidian", kind = BackgroundSolid, character = "black glass", detail = "low" }
    , { id = "lapis-gradient", label = "Lapis Gradient", kind = BackgroundSolid, character = "blue mineral", detail = "low" }
    , { id = "paper-grain", label = "Paper grain", kind = BackgroundSolid, character = "warm paper", detail = "low" }
    , { id = "retro-arcade", label = "Retro Arcade", kind = BackgroundScene, character = "pixel neon", detail = "high" }
    , { id = "starfield", label = "Starfield", kind = BackgroundScene, character = "open sky", detail = "medium" }
    , { id = "lightning", label = "Thunderstorm", kind = BackgroundScene, character = "storm front", detail = "high" }
    , { id = "phoenix", label = "Phoenix", kind = BackgroundScene, character = "fire bird", detail = "high" }
    , { id = "aurora-borealis", label = "Aurora Borealis", kind = BackgroundScene, character = "northern lights", detail = "medium" }
    , { id = "volcanic", label = "Volcanic", kind = BackgroundScene, character = "lava field", detail = "high" }
    , { id = "neon-night", label = "Neon night", kind = BackgroundScene, character = "city neon", detail = "medium" }
    ]


{-| Picker groups in display order (mirroring `GROUPS`): the theme
follower, living ambient, quiet stills, featured scenes, more
presets.
-}
backgroundGroups : List ( String, List BackgroundOption )
backgroundGroups =
    let
        auto =
            [ { id = autoBackgroundId, label = "Match my theme", kind = BackgroundAnimated, character = "theme signature", detail = "low" } ]

        animated =
            List.filter (\option -> option.kind == BackgroundAnimated) backgroundOptions

        solid =
            List.filter (\option -> option.kind == BackgroundSolid) backgroundOptions

        scenes =
            List.filter (\option -> option.kind == BackgroundScene) backgroundOptions
    in
    [ ( "Match my theme", auto )
    , ( "Living ambient", animated )
    , ( "Quiet stills", solid )
    , ( "Featured scenes", List.take 4 scenes )
    , ( "More presets", List.drop 4 scenes )
    ]


isValidBackgroundId : String -> Bool
isValidBackgroundId id =
    List.any (\option -> option.id == id) backgroundOptions


{-| Resolve the concrete background id to render, given the stored
preference and the active theme. `'auto'` (or an empty/unknown value)
maps to the theme's `signatureBg`; a pinned id passes through
unchanged. Custom themes inherit their base theme's signature
(mirroring `resolveBackgroundId`).
-}
resolveBackgroundId : String -> String -> List CustomThemeRef -> String
resolveBackgroundId preference themeId customs =
    if not (String.isEmpty preference) && preference /= autoBackgroundId && isValidBackgroundId preference then
        preference

    else
        let
            baseId =
                if isCustomThemeId themeId then
                    List.filter (\custom -> custom.id == themeId) customs
                        |> List.head
                        |> Maybe.map .base
                        |> Maybe.withDefault defaultThemeId

                else
                    themeId
        in
        themeById baseId |> Maybe.map .signatureBg |> Maybe.withDefault fallbackBackgroundId
