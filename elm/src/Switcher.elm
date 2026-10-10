module Switcher exposing
    ( Action(..)
    , Entry
    , Matched
    , Palette
    , Section(..)
    , Shortcut(..)
    , ShortcutGroup
    , Target(..)
    , activeOptionId
    , clampActive
    , closed
    , entries
    , fuzzyMatch
    , groupHeadingId
    , matches
    , move
    , optionId
    , rank
    , resultsAnnouncement
    , sectionIcon
    , sectionLabel
    , segments
    , shortcutFromString
    , shortcutGroups
    )

{-| v3/switcher — the Ctrl/Cmd+K action palette and the `?` shortcuts
overlay, as pure data (mirroring `chat/spotlight/Spotlight.tsx`,
`chat/spotlight/fuzzy.ts`, `chat/spotlight/commands.ts` and
`shell/ShortcutsOverlay.tsx`).

The palette is a combobox: the input keeps DOM focus and the listbox
highlight is virtual (`aria-activedescendant`). Navigation order is
the display order (Rooms, then DMs, then Actions; best match first
inside each), so the arrow keys never jump around the list.

Global keys arrive through ONE incoming `shortcut` port: `ports.js`
owns the scope rules (never inside editable fields except Ctrl/Cmd+K
and Escape) and sends a short name decoded by `shortcutFromString`.

-}

import Dict exposing (Dict)



-- PALETTE STATE


{-| Open flag, committed query and the virtual highlight (an index
into `matches`). -}
type alias Palette =
    { open : Bool
    , query : String
    , active : Int
    }


closed : Palette
closed =
    { open = False, query = "", active = 0 }



-- ENTRIES


type Section
    = Rooms
    | DMs
    | Actions


sectionLabel : Section -> String
sectionLabel section =
    case section of
        Rooms ->
            "Rooms"

        DMs ->
            "DMs"

        Actions ->
            "Actions"


{-| Leading glyph per section (oracle `SECTION_ICON`). -}
sectionIcon : Section -> String
sectionIcon section =
    case section of
        Rooms ->
            "#"

        DMs ->
            "@"

        Actions ->
            "→"


sectionOrder : Section -> Int
sectionOrder section =
    case section of
        Rooms ->
            0

        DMs ->
            1

        Actions ->
            2


type Action
    = BrowseRooms
    | StartRoom
    | NewConversation
    | JumpToDate
    | Notifications
    | Appearance
    | YouHub
    | KeyboardShortcuts
    | Leave


type Target
    = GoRoom String
    | GoDm String
    | Do Action


{-| One palette row; `id` is stable (`channel:#x`, `dm:nick`,
`action:…`) so recents can key on it later. -}
type alias Entry =
    { id : String
    , section : Section
    , title : String
    , hint : String
    , keywords : List String
    , target : Target
    }


type alias Matched =
    { entry : Entry
    , score : Float
    , ranges : List ( Int, Int )
    }


{-| Room and DM rows (oracle `Go to #x` / `Open DM with nick`) followed
by the shell actions. Rooms sort by name, DMs by name; Jump to date is
offered only with a conversation open. -}
entries :
    (String -> Bool)
    -> Maybe String
    -> List { a | name : String, topic : String, unread : Int, members : Dict String m }
    -> List Entry
entries isChannel active conversations =
    let
        byName =
            List.sortBy (\c -> String.toLower c.name) conversations

        ( rooms, dms ) =
            List.partition (\c -> isChannel c.name) byName

        roomEntry c =
            { id = "channel:" ++ String.toLower c.name
            , section = Rooms
            , title = "Go to " ++ c.name
            , hint = channelHint (Dict.size c.members) c.unread c.topic
            , keywords = [ c.name, dropSigil c.name, c.topic ]
            , target = GoRoom c.name
            }

        dmEntry c =
            { id = "dm:" ++ String.toLower c.name
            , section = DMs
            , title = "Open DM with " ++ c.name
            , hint =
                if c.unread > 0 then
                    String.fromInt c.unread ++ " unread"

                else
                    ""
            , keywords = [ c.name, "direct message", "dm" ]
            , target = GoDm c.name
            }
    in
    List.map roomEntry rooms ++ List.map dmEntry dms ++ actionEntries active


dropSigil : String -> String
dropSigil name =
    if String.startsWith "#" name || String.startsWith "&" name then
        String.dropLeft 1 name

    else
        name


{-| Oracle `channelHint`: users, unread, topic joined by ` · `. -}
channelHint : Int -> Int -> String -> String
channelHint users unread topic =
    String.join " · "
        ([ String.fromInt users ++ " users" ]
            ++ (if unread > 0 then
                    [ String.fromInt unread ++ " unread" ]

                else
                    []
               )
            ++ (if String.isEmpty (String.trim topic) then
                    []

                else
                    [ topic ]
               )
        )


action : String -> String -> String -> List String -> Action -> Entry
action id title hint keywords act =
    { id = "action:" ++ id
    , section = Actions
    , title = title
    , hint = hint
    , keywords = keywords
    , target = Do act
    }


actionEntries : Maybe String -> List Entry
actionEntries active =
    [ action "browse-rooms" "Browse rooms" "Find a public room to join" [ "rooms", "channels", "browse", "list", "discover", "directory" ] BrowseRooms
    , action "create-room" "Start a room" "Name a place and invite a few friends" [ "rooms", "create", "start", "new", "invite", "friends" ] StartRoom
    , action "new-conversation" "New conversation" "Message someone directly" [ "dm", "direct message", "private", "message", "new", "people" ] NewConversation
    ]
        ++ (case active of
                Just target ->
                    [ action "jump-to-date" "Jump to date…" target [ "jump", "date", "time", "history", "travel", "go to date", "when" ] JumpToDate ]

                Nothing ->
                    []
           )
        ++ [ action "notifications" "Notifications" "Alerts, sounds, do not disturb" [ "notifications", "alerts", "sound", "dnd", "do not disturb", "mute", "keywords" ] Notifications
           , action "appearance" "Appearance — theme & background" "/appearance" [ "theme", "background", "customize", "appearance", "color", "dark", "light" ] Appearance
           , action "you" "You" "Account, this device, help" [ "you", "account", "settings", "profile", "device", "help" ] YouHub
           , action "keyboard-shortcuts" "Open keyboard shortcuts" "?" [ "shortcuts", "keyboard", "keys", "help" ] KeyboardShortcuts
           , action "disconnect" "Disconnect" "Leave Onyx" [ "leave", "quit", "close", "server", "node", "sign out" ] Leave
           ]



-- RANKING (port of `fuzzy.ts`)


{-| Oracle `fuzzyMatch`: empty query matches everything unhighlighted;
otherwise the best of the title (with highlight ranges, half-open
char offsets) and the keywords (38-point penalty, no highlight). -}
fuzzyMatch : String -> String -> List String -> Maybe { score : Float, ranges : List ( Int, Int ) }
fuzzyMatch query title keywords =
    let
        needle =
            String.toLower (String.trim query)
    in
    if String.isEmpty needle then
        Just { score = 0, ranges = [] }

    else
        let
            fromTitle =
                scoreCandidate title needle
                    |> Maybe.map (\m -> { score = m.score, ranges = compactRanges m.indices })

            pick keyword best =
                case scoreCandidate keyword needle of
                    Nothing ->
                        best

                    Just m ->
                        let
                            candidate =
                                { score = m.score - 38, ranges = [] }
                        in
                        case best of
                            Just b ->
                                if candidate.score > b.score then
                                    Just candidate

                                else
                                    best

                            Nothing ->
                                Just candidate
        in
        List.foldl pick fromTitle keywords


boundaryChars : List Char
boundaryChars =
    [ '#', '/', '@', ':', '_', '-' ]


isWordBoundary : Dict Int Char -> Int -> Bool
isWordBoundary chars index =
    if index == 0 then
        True

    else
        case ( Dict.get (index - 1) chars, Dict.get index chars ) of
            ( Just previous, Just current ) ->
                isSpace previous
                    || List.member previous boundaryChars
                    || (previous == Char.toLower previous && current == Char.toUpper current)

            _ ->
                False


isSpace : Char -> Bool
isSpace c =
    c == ' ' || c == '\t' || c == '\n' || c == '\u{000D}' || c == '\u{00A0}'


scoreCandidate : String -> String -> Maybe { score : Float, indices : List Int }
scoreCandidate text needle =
    let
        original =
            String.toList text

        folded =
            List.map Char.toLower original

        needleChars =
            String.toList needle

        greedy hay need index acc =
            case ( hay, need ) of
                ( _, [] ) ->
                    Just (List.reverse acc)

                ( [], _ ) ->
                    Nothing

                ( h :: hs, n :: ns ) ->
                    if h == n then
                        greedy hs ns (index + 1) (index :: acc)

                    else
                        greedy hs need (index + 1) acc
    in
    case greedy folded needleChars 0 [] of
        Nothing ->
            Nothing

        Just indices ->
            let
                chars =
                    Dict.fromList (List.indexedMap Tuple.pair original)

                first =
                    Maybe.withDefault 0 (List.head indices)

                base =
                    120 - toFloat first * 2 + toFloat (List.length needleChars) * 12

                step current ( previous, acc ) =
                    let
                        boundary =
                            if isWordBoundary chars current then
                                12

                            else
                                0

                        adjacency =
                            case previous of
                                Nothing ->
                                    0

                                Just p ->
                                    if current - p == 1 then
                                        18

                                    else
                                        toFloat (max 0 (10 - (current - p)))
                    in
                    ( Just current, acc + boundary + adjacency )

                ( _, walked ) =
                    List.foldl step ( Nothing, base ) indices

                haystack =
                    String.fromList folded

                substring =
                    case String.indexes needle haystack of
                        at :: _ ->
                            -- `String.indexes` counts UTF-16 units; map back to chars.
                            70 - toFloat (List.length (String.toList (String.left at haystack)))

                        [] ->
                            0

                prefix =
                    if String.startsWith needle haystack then
                        45

                    else
                        0
            in
            Just { score = walked + substring + prefix, indices = indices }


compactRanges : List Int -> List ( Int, Int )
compactRanges indices =
    case indices of
        [] ->
            []

        first :: rest ->
            let
                step current ( ( start, end ), acc ) =
                    if current == end then
                        ( ( start, end + 1 ), acc )

                    else
                        ( ( current, current + 1 ), ( start, end ) :: acc )

                ( last, done ) =
                    List.foldl step ( ( first, first + 1 ), [] ) rest
            in
            List.reverse (last :: done)


{-| Oracle `fuzzyFilter`: score each entry (an index tiebreak keeps
input order among equals), drop misses, best first. -}
rank : String -> List Entry -> List Matched
rank query items =
    items
        |> List.indexedMap
            (\index entry ->
                fuzzyMatch query entry.title entry.keywords
                    |> Maybe.map (\m -> { entry = entry, score = m.score - toFloat index * 0.001, ranges = m.ranges })
            )
        |> List.filterMap identity
        |> List.sortBy (\m -> negate m.score)


{-| Ranked rows in display (= navigation) order: Rooms, DMs, Actions,
best match first inside each section. -}
matches : String -> List Entry -> List Matched
matches query items =
    rank query items
        |> List.indexedMap Tuple.pair
        |> List.sortBy (\( i, m ) -> ( sectionOrder m.entry.section, i ))
        |> List.map Tuple.second


{-| Split a title into (text, highlighted) runs by char ranges. -}
segments : String -> List ( Int, Int ) -> List ( String, Bool )
segments title ranges =
    let
        chars =
            String.toList title

        slice from to =
            String.fromList (List.take (to - from) (List.drop from chars))

        total =
            List.length chars

        step ( start, end ) ( cursor, acc ) =
            let
                before =
                    if start > cursor then
                        [ ( slice cursor start, False ) ]

                    else
                        []
            in
            ( end, ( slice start end, True ) :: List.reverse before ++ acc )

        ( final, built ) =
            List.foldl step ( 0, [] ) ranges

        tail =
            if final < total then
                [ ( slice final total, False ) ]

            else
                []
    in
    List.reverse built ++ tail



-- NAVIGATION


{-| Arrow movement wraps both ways; nothing to move through stays 0. -}
move : Int -> Int -> Int -> Int
move delta count index =
    if count <= 0 then
        0

    else
        modBy count (index + delta)


{-| Keep the highlight inside a (possibly shrunk) result set. -}
clampActive : Int -> Int -> Int
clampActive count index =
    if count <= 0 then
        0

    else
        clamp 0 (count - 1) index


optionId : Int -> String
optionId index =
    "onyx-spotlight-option-" ++ String.fromInt index


activeOptionId : Int -> Int -> Maybe String
activeOptionId count index =
    if count > 0 then
        Just (optionId (clampActive count index))

    else
        Nothing


{-| Polite results summary (keyed to the result set only). -}
resultsAnnouncement : String -> Int -> String
resultsAnnouncement query count =
    if count == 0 then
        if String.isEmpty (String.trim query) then
            ""

        else
            "No matching command"

    else
        String.fromInt count
            ++ " command"
            ++ (if count == 1 then
                    ""

                else
                    "s"
               )
            ++ " available"



-- GLOBAL SHORTCUTS


{-| What `ports.js` delivers through the `shortcut` port. -}
type Shortcut
    = TogglePalette
    | OpenPalette
    | ShowShortcuts
    | Dismiss
      -- v3/calls-c11 (C12): `call-<name>` modifier chords
    | CallChord String
    | UnknownShortcut


shortcutFromString : String -> Shortcut
shortcutFromString raw =
    case raw of
        "palette-toggle" ->
            TogglePalette

        "palette" ->
            OpenPalette

        "shortcuts" ->
            ShowShortcuts

        "escape" ->
            Dismiss

        _ ->
            if String.startsWith "call-" raw then
                CallChord (String.dropLeft 5 raw)

            else
                UnknownShortcut



-- SHORTCUTS OVERLAY


type alias ShortcutGroup =
    { group : String
    , rows : List { chords : List String, description : String }
    }


{-| The help rows (oracle `SHORTCUTS`, narrowed to the chords this
client actually handles so the sheet never advertises a dead key). -}
shortcutGroups : List ShortcutGroup
shortcutGroups =
    [ { group = "Palette"
      , rows =
            [ { chords = [ "⌘K", "Ctrl+K" ], description = "Open command palette" }
            , { chords = [ "/" ], description = "Open command palette (when not typing)" }
            , { chords = [ "?" ], description = "Show keyboard shortcuts" }
            , { chords = [ "Esc" ], description = "Close palette / overlay" }
            ]
      }
    , { group = "Chat"
      , rows =
            [ { chords = [ "⌘F", "Ctrl+F" ], description = "Search messages" } ]
      }

    -- v3/calls-c11 (C12): active only in a live call, never while typing
    , { group = "Voice & Video"
      , rows = callShortcutRows
      }
    ]


{-| Call chords (spec §3.1). Every chord carries a modifier (WCAG
2.1.4). Provisional (§7.1): the microphone takes Ctrl+Shift+M; the
oracle's room-notification mute on that chord is not bound in this
client. Captions (C8) and push to talk (C9) are not listed until they
land.
-}
callShortcutRows : List { chords : List String, description : String }
callShortcutRows =
    [ { chords = [ "⌘⇧M", "Ctrl+Shift+M" ], description = "Mute / unmute microphone" }
    , { chords = [ "⌘⇧E", "Ctrl+Shift+E" ], description = "Turn camera on / off" }
    , { chords = [ "⌘⇧H", "Ctrl+Shift+H" ], description = "Raise / lower hand (stage audience)" }
    , { chords = [ "⌘⇧L", "Ctrl+Shift+L" ], description = "Leave call (asks first with more than 2 people)" }
    , { chords = [ "⌘⇧G", "Ctrl+Shift+G" ], description = "Cycle layout: grid, spotlight, screen share" }
    , { chords = [ "⌘⇧F", "Ctrl+Shift+F" ], description = "Cycle call stage size" }
    , { chords = [ "⌘⇧S", "Ctrl+Shift+S" ], description = "Announce who is speaking" }
    , { chords = [ "Esc" ], description = "Exit fullscreen call stage" }
    ]


{-| Oracle `groupHeadingId`. -}
groupHeadingId : String -> String
groupHeadingId group =
    let
        slug =
            String.toLower group
                |> String.toList
                |> List.map
                    (\c ->
                        if Char.isAlphaNum c then
                            c

                        else
                            '-'
                    )
                |> String.fromList
                |> String.split "-"
                |> List.filter (not << String.isEmpty)
                |> String.join "-"
    in
    "shortcuts-overlay-"
        ++ (if String.isEmpty slug then
                "group"

            else
                slug
           )
