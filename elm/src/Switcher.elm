module Switcher exposing
    ( Action(..)
    , AppChord(..)
    , Context
    , Entry
    , Matched
    , Palette
    , Person
    , Section(..)
    , Shortcut(..)
    , ShortcutGroup
    , Target(..)
    , activeOptionId
    , build
    , clampActive
    , closed
    , conversationOrder
    , entries
    , fuzzyMatch
    , groupHeadingId
    , matches
    , matchesWith
    , maxRecents
    , move
    , optionId
    , rank
    , recentId
    , recordRecent
    , resultsAnnouncement
    , sectionIcon
    , sectionLabel
    , sections
    , segments
    , shortcutFromString
    , shortcutGroups
    , stepConversation
    , stepUnread
    )

{-| v3/switcher — the Ctrl/Cmd+K action palette and the `?` shortcuts
overlay, as pure data (mirroring `chat/spotlight/Spotlight.tsx`,
`chat/spotlight/fuzzy.ts`, `chat/spotlight/commands.ts` and
`shell/ShortcutsOverlay.tsx`).

The palette is a combobox: the input keeps DOM focus and the listbox
highlight is virtual (`aria-activedescendant`). Navigation order is
the display order (Recent, Rooms, DMs, People, then Actions; best
match first inside each), so the arrow keys never jump around the list.

Global keys arrive through ONE incoming `shortcut` port: `ports.js`
owns the scope rules (never inside editable fields except Ctrl/Cmd+K
and Escape) and sends a short name decoded by `shortcutFromString`.

-}

import Dict exposing (Dict)
import Set



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
    = Recent
    | Rooms
    | DMs
    | People
    | Actions


{-| Display (= navigation) order of the sections. -}
sections : List Section
sections =
    [ Recent, Rooms, DMs, People, Actions ]


sectionLabel : Section -> String
sectionLabel section =
    case section of
        Recent ->
            "Recent"

        Rooms ->
            "Rooms"

        DMs ->
            "DMs"

        People ->
            "People"

        Actions ->
            "Actions"


{-| Leading glyph per section (oracle `SECTION_ICON`). -}
sectionIcon : Section -> String
sectionIcon section =
    case section of
        Recent ->
            "↺"

        Rooms ->
            "#"

        DMs ->
            "@"

        People ->
            "@"

        Actions ->
            "→"


sectionOrder : Section -> Int
sectionOrder section =
    case section of
        Recent ->
            0

        Rooms ->
            1

        DMs ->
            2

        People ->
            3

        Actions ->
            4


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
      -- v3/gap-commands
    | JoinTyped String
    | Preferences
    | ThemeStudio
    | ScheduledMessages
    | SlashCommands
    | SearchMessages
    | CopyRoomLink String
    | CopyNodeAddress
    | InvitePeople String
    | StartVoice String
    | ReturnToCall
    | MarkAllRead
    | MarkRead String
    | CatchUp String
    | LeaveRoom String
    | ToggleStar String
    | ToggleMute String
    | ToggleDnd
    | PauseAlerts Int
    | ToggleAway
    | ToggleDensity
    | SwitchTheme String


type Target
    = GoRoom String
    | GoDm String
      -- v3/gap-commands
    | GoPerson String
    | ViewProfile String
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




-- v3/gap-commands — palette breadth (People, recents, the oracle's
-- action rows and a little query grammar)


{-| What the palette knows about the shell beyond the conversation
list. `call` is the room of the live call; `voice` says whether a
voice call can start in the active room. -}
type alias Context =
    { active : Maybe String
    , activeIsRoom : Bool
    , live : Bool
    , starred : Bool
    , muted : Bool
    , dnd : Bool
    , away : Bool
    , compact : Bool
    , call : Maybe String
    , voice : Bool
    , node : String
    , themes : List { id : String, label : String }
    , theme : String
    }


{-| A person the palette can message: a member of the active room or
a contact, never someone who already has a DM row. -}
type alias Person =
    { nick : String
    , hint : String
    }


{-| Every palette row for the current shell and query: rooms, DMs,
people, then actions (contextual room actions first, the query grammar
rows — `#room` joins, `mute 30`, theme switching, profiles — only
while typing). -}
build :
    (String -> Bool)
    -> Context
    -> String
    -> List { a | name : String, topic : String, unread : Int, highlights : Int, members : Dict String m }
    -> List Person
    -> List Entry
build isChannel ctx query conversations people =
    let
        ( conversationRows, shellActions ) =
            List.partition (\e -> e.section /= Actions) (entries isChannel ctx.active conversations)

        typing =
            not (String.isEmpty (String.trim query))

        joined =
            Set.fromList (List.map (\c -> String.toLower c.name) conversations)

        personRow person =
            { id = "person:" ++ String.toLower person.nick
            , section = People
            , title = "Message " ++ person.nick
            , hint = person.hint
            , keywords = [ person.nick, "dm", "message", "people", "direct message" ]
            , target = GoPerson person.nick
            }

        profileRow person =
            { id = "profile:" ++ String.toLower person.nick
            , section = People
            , title = "View profile: " ++ person.nick
            , hint = person.hint
            , keywords = [ person.nick, "profile", "whois", "who is" ]
            , target = ViewProfile person.nick
            }

        unreadRooms =
            conversations
                |> List.filter (\c -> c.unread > 0 && Maybe.map String.toLower ctx.active /= Just (String.toLower c.name))
                |> List.sortBy (\c -> ( negate c.highlights, negate c.unread, String.toLower c.name ))
                |> List.take 6

        catchUpRow c =
            action ("catch-up:" ++ String.toLower c.name)
                ("Catch up: " ++ c.name)
                (unreadHint c.unread c.highlights)
                [ "catch up", "unread", "jump", "first unread", "new messages", c.name ]
                (CatchUp c.name)

        themeRow meta =
            action ("theme:" ++ meta.id)
                ("Switch theme: " ++ meta.label)
                "Appearance"
                [ "theme", "look", meta.id, meta.label ]
                (SwitchTheme meta.id)
    in
    -- While typing, a person row matches on the person, never on the
    -- shared "Message" / "View profile" wording (a query of "i" must not
    -- list everyone); profiles join once two characters narrow it.
    let
        matchedPeople =
            if typing then
                List.filter (\person -> fuzzyMatch query person.nick [] /= Nothing) people

            else
                people
    in
    conversationRows
        ++ List.map personRow matchedPeople
        ++ (if String.length (String.trim query) >= 2 then
                List.map profileRow matchedPeople

            else
                []
           )
        ++ typedActions ctx query joined
        ++ roomActions ctx
        ++ List.take 3 shellActions
        ++ List.map catchUpRow unreadRooms
        ++ (if List.any (\c -> c.unread > 0) conversations then
                [ action "mark-all-read" "Mark all read" "Clear every unread badge on this device" [ "mark", "read", "all", "caught up", "clear", "unread" ] MarkAllRead ]

            else
                []
           )
        ++ List.filter (\e -> e.target /= Do Leave) (List.drop 3 shellActions)
        ++ globalActions ctx
        ++ (if typing then
                List.map themeRow (List.filter (\meta -> meta.id /= ctx.theme) ctx.themes)

            else
                []
           )
        ++ List.filter (\e -> e.target == Do Leave) shellActions


unreadHint : Int -> Int -> String
unreadHint unread highlights =
    String.fromInt unread
        ++ " unread"
        ++ (if highlights > 0 then
                " · " ++ String.fromInt highlights ++ " for you"

            else
                ""
           )


{-| Rows the query itself proposes: `#room` (or `join room`) offers to
join a room not yet joined; `mute 30` / `snooze 30` / `dnd 30` offers
to pause alerts for that many minutes (1–1440). -}
typedActions : Context -> String -> Set.Set String -> List Entry
typedActions ctx query joined =
    let
        typed =
            String.toLower (String.trim query)

        words =
            List.filter (not << String.isEmpty) (String.words typed)

        roomName raw =
            let
                bare =
                    if String.startsWith "#" raw then
                        String.dropLeft 1 raw

                    else
                        raw
            in
            if String.length bare >= 1 && String.length bare <= 63 && String.all isRoomChar bare then
                Just ("#" ++ bare)

            else
                Nothing

        joinRow raw =
            case roomName raw of
                Just room ->
                    if Set.member (String.toLower room) joined || not ctx.live then
                        []

                    else
                        [ action ("join:" ++ room) ("Join " ++ room) "Open a room by name" [ typed, "join", "room", raw, room ] (JoinTyped room) ]

                Nothing ->
                    []

        pauseRow raw =
            case String.toInt raw of
                Just minutes ->
                    if minutes >= 1 && minutes <= 1440 then
                        [ action ("pause:" ++ String.fromInt minutes)
                            ("Pause alerts for " ++ String.fromInt minutes ++ (if minutes == 1 then " minute" else " minutes"))
                            "Do not disturb, then resume"
                            [ typed, "mute", "snooze", "dnd", "pause", raw ]
                            (PauseAlerts minutes)
                        ]

                    else
                        []

                Nothing ->
                    []
    in
    case words of
        [ single ] ->
            if String.startsWith "#" single then
                joinRow single

            else
                []

        [ verb, arg ] ->
            if verb == "join" || verb == "/join" || verb == "/j" then
                joinRow arg

            else if List.member verb [ "mute", "snooze", "dnd", "pause" ] then
                pauseRow arg

            else
                []

        _ ->
            []


isRoomChar : Char -> Bool
isRoomChar c =
    Char.isAlphaNum c || List.member c [ '-', '_', '.', '+', '!', '~', '=', '^', '[', ']', '{', '}', '|', '\\', '`', '\'' ]
        || Char.toCode c > 127


{-| Actions about the open room (or DM). -}
roomActions : Context -> List Entry
roomActions ctx =
    case ctx.active of
        Nothing ->
            []

        Just name ->
            if ctx.activeIsRoom then
                [ action "copy-room-link" "Copy room link" name [ "copy", "link", "room", "share", "invite", "url", name ] (CopyRoomLink name)
                , action "invite-people" ("Invite people to " ++ name) "Share an invite link" [ "invite", "share", "friends", "people", name ] (InvitePeople name)
                ]
                    ++ voiceActions ctx name
                    ++ [ if ctx.starred then
                            action "unstar-room" ("Unstar " ++ name) "Remove from Favorites" [ "star", "unstar", "favorite", "favourite", name ] (ToggleStar name)

                         else
                            action "star-room" ("Star " ++ name) "Pin to Favorites" [ "star", "favorite", "favourite", "pin", name ] (ToggleStar name)
                       , if ctx.muted then
                            action "unmute-room" ("Unmute " ++ name) "Notifications on for this room" [ "mute", "unmute", "notifications", "alerts", name ] (ToggleMute name)

                         else
                            action "mute-room" ("Mute " ++ name) "Silence this room on this device" [ "mute", "silence", "notifications", "alerts", name ] (ToggleMute name)
                       , action "mark-read" ("Mark " ++ name ++ " read") "Ctrl+Shift+E" [ "mark", "read", "clear", "unread", name ] (MarkRead name)
                       , action "leave-room" ("Leave " ++ name) "Part the room" [ "leave", "part", "exit", "close", "hide", name ] (LeaveRoom name)
                       ]

            else
                voiceActions ctx name
                    ++ [ action "mark-read" ("Mark " ++ name ++ " read") "Ctrl+Shift+E" [ "mark", "read", "clear", "unread", name ] (MarkRead name) ]


voiceActions : Context -> String -> List Entry
voiceActions ctx name =
    case ctx.call of
        Just room ->
            [ action "return-to-call" "Return to call" room [ "voice", "call", "return", "back", room ] ReturnToCall ]

        Nothing ->
            if ctx.voice && ctx.live then
                [ action "start-voice" "Start voice call" name [ "voice", "audio", "call", "join", "talk", name ] (StartVoice name) ]

            else
                []


{-| Shell-wide actions after the oracle rows. -}
globalActions : Context -> List Entry
globalActions ctx =
    [ action "search-messages" "Search messages" "Ctrl+F" [ "search", "find", "history", "messages" ] SearchMessages
    , action "scheduled-messages" "Scheduled messages" "Open the send-later queue" [ "scheduled", "schedule", "send later", "queue", "remind", "pending", "later" ] ScheduledMessages
    , if ctx.dnd then
        action "dnd" "Turn off Do Not Disturb" "Ctrl+Shift+D" [ "dnd", "do not disturb", "alerts", "notifications", "quiet", "focus" ] ToggleDnd

      else
        action "dnd" "Turn on Do Not Disturb" "Ctrl+Shift+D" [ "dnd", "do not disturb", "alerts", "notifications", "quiet", "focus" ] ToggleDnd
    , if ctx.away then
        action "away" "Set yourself back" "Clear your away status" [ "away", "back", "status", "present", "online" ] ToggleAway

      else
        action "away" "Set yourself away" "Others see you are away" [ "away", "status", "afk", "brb" ] ToggleAway
    , if ctx.compact then
        action "density" "Comfortable message density" "Avatars and grouped messages" [ "density", "comfortable", "grouped", "avatars", "spacing", "compact" ] ToggleDensity

      else
        action "density" "Compact message density" "One line per message, IRC style" [ "density", "compact", "irc", "dense", "spacing" ] ToggleDensity
    , action "preferences" "Preferences — display & behaviour" "Ctrl+," [ "preferences", "settings", "density", "font", "size", "width", "motion", "events", "display", "behaviour", "behavior" ] Preferences
    , action "theme-studio" "Open Theme Studio" "/appearance" [ "theme", "studio", "custom", "tokens", "editor", "create theme" ] ThemeStudio
    , action "slash-commands" "Slash commands" "/help" [ "commands", "slash", "help", "irc", "verbs" ] SlashCommands
    ]
        ++ (if String.isEmpty ctx.node then
                []

            else
                [ action "copy-node-address" "Copy node address" ctx.node [ "copy", "server", "url", "address", "node" ] CopyNodeAddress ]
           )


{-| The id a run row leaves in the recents list (`Nothing` for rows
the query made up). Messaging a person recalls as their DM. -}
recentId : Entry -> Maybe String
recentId entry =
    case entry.target of
        GoPerson nick ->
            Just ("dm:" ++ String.toLower nick)

        ViewProfile _ ->
            Nothing

        Do (JoinTyped _) ->
            Nothing

        Do (PauseAlerts _) ->
            Nothing

        Do (SwitchTheme _) ->
            Nothing

        Do (CatchUp _) ->
            Nothing

        Do Leave ->
            Nothing

        _ ->
            Just entry.id


{-| Most recent first, unique, bounded. -}
recordRecent : String -> List String -> List String
recordRecent id list =
    List.take 8 (id :: List.filter (\kept -> kept /= id) list)


{-| How many recents the quiet palette lifts into its Recent section. -}
maxRecents : Int
maxRecents =
    5


{-| `matches` with recents: with no query the recent rows (still
present) lead in their own section; while typing they rank a little
higher inside their own. People rows stay short (5 quiet, 12 typing).
-}
matchesWith : List String -> String -> List Entry -> List Matched
matchesWith recents query items =
    let
        quiet =
            String.isEmpty (String.trim query)

        lookup id =
            List.filter (\e -> e.id == id) items |> List.head

        recentRows =
            if quiet then
                recents
                    |> List.filterMap lookup
                    |> List.take maxRecents
                    |> List.map (\e -> { e | section = Recent })

            else
                []

        lifted =
            Set.fromList (List.map .id recentRows)

        rest =
            List.filter (\e -> not (Set.member e.id lifted)) items

        boost m =
            if not quiet && List.member m.entry.id recents then
                { m | score = m.score + 25 }

            else
                m

        peopleCap =
            if quiet then
                5

            else
                12

        capPeople m ( kept, seen ) =
            if m.entry.section == People then
                if seen >= peopleCap then
                    ( kept, seen )

                else
                    ( m :: kept, seen + 1 )

            else
                ( m :: kept, seen )
    in
    rank query (recentRows ++ rest)
        |> List.map boost
        |> List.sortBy (\m -> negate m.score)
        |> List.indexedMap Tuple.pair
        |> List.sortBy (\( i, m ) -> ( sectionOrder m.entry.section, i ))
        |> List.map Tuple.second
        |> List.foldl capPeople ( [], 0 )
        |> Tuple.first
        |> List.reverse


{-| Sidebar order for Alt+↑/↓: Favorites then Rooms (alphabetical,
case-insensitive), then DMs newest first (mirroring `Sidebar.sections`
without its filter). -}
conversationOrder :
    (String -> Bool)
    -> (String -> Bool)
    -> List { a | name : String, lastSeen : Maybe Int, messages : List { b | at : Int } }
    -> List String
conversationOrder isChannel isStarred conversations =
    let
        ( rooms, dms ) =
            List.partition (\c -> isChannel c.name) conversations

        alpha =
            List.sortWith
                (\x y ->
                    case compare (String.toLower x.name) (String.toLower y.name) of
                        EQ ->
                            compare x.name y.name

                        other ->
                            other
                )

        ( favorites, others ) =
            List.partition (\c -> isStarred c.name) (alpha rooms)

        activity c =
            List.foldl (\m best -> max best m.at) (max 0 (Maybe.withDefault 0 c.lastSeen)) c.messages

        recency x y =
            case compare (activity y) (activity x) of
                EQ ->
                    compare (String.toLower x.name) (String.toLower y.name)

                other ->
                    other
    in
    List.map .name (favorites ++ others ++ List.sortWith recency dms)


indexOfName : Maybe String -> List String -> Maybe Int
indexOfName active order =
    case active of
        Nothing ->
            Nothing

        Just name ->
            order
                |> List.indexedMap Tuple.pair
                |> List.filter (\( _, n ) -> String.toLower n == String.toLower name)
                |> List.head
                |> Maybe.map Tuple.first


{-| Alt+↑ / Alt+↓: the previous / next conversation, wrapping; with
none open, ↓ starts at the top and ↑ at the bottom. -}
stepConversation : Int -> Maybe String -> List String -> Maybe String
stepConversation delta active order =
    let
        count =
            List.length order
    in
    if count == 0 then
        Nothing

    else
        case indexOfName active order of
            Just i ->
                List.head (List.drop (modBy count (i + delta)) order)

            Nothing ->
                if delta >= 0 then
                    List.head order

                else
                    List.head (List.reverse order)


{-| Alt+Shift+↑ / ↓ (and N): the previous / next conversation with
something unread, wrapping, never the open one. -}
stepUnread : Int -> Maybe String -> List String -> (String -> Bool) -> Maybe String
stepUnread delta active order isUnread =
    let
        indexed =
            List.indexedMap Tuple.pair order

        current =
            Maybe.withDefault
                (if delta >= 0 then
                    -1

                 else
                    List.length order
                )
                (indexOfName active order)

        candidates =
            List.filter (\( i, name ) -> i /= current && isUnread name) indexed
    in
    if delta >= 0 then
        case List.filter (\( i, _ ) -> i > current) candidates of
            ( _, name ) :: _ ->
                Just name

            [] ->
                List.head candidates |> Maybe.map Tuple.second

    else
        case List.reverse (List.filter (\( i, _ ) -> i < current) candidates) of
            ( _, name ) :: _ ->
                Just name

            [] ->
                List.head (List.reverse candidates) |> Maybe.map Tuple.second


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


{-| Ranked rows in display (= navigation) order: Recent, Rooms, DMs,
People, Actions, best match first inside each section. -}
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
      -- v3/gap-commands: the shell chords (oracle `shortcutsRegistry`)
    | AppChord AppChord
      -- the single-key shortcuts preference, as stored on this device
    | SingleKeys Bool
    | UnknownShortcut


{-| Shell chords that change Elm state. Pure-focus keys (J/K message
focus, Enter / Alt+Enter composer focus, Alt+S sidebar focus, Alt+M
member list) run inside `ports.js` and never reach Elm. -}
type AppChord
    = ConversationStep Int
    | UnreadStep Int
    | GoHome
    | GoJumpToDate
    | OpenPreferences
    | OpenAccount
    | MarkConversationRead
    | ToggleDndChord
    | ToggleRoomMute
    | ToggleRoomStar
    | AttachFiles
    | ScheduleSend
    | ExportTranscript
    | FollowToggle


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

        -- v3/gap-commands
        "conv-prev" ->
            AppChord (ConversationStep -1)

        "conv-next" ->
            AppChord (ConversationStep 1)

        "unread-prev" ->
            AppChord (UnreadStep -1)

        "unread-next" ->
            AppChord (UnreadStep 1)

        "next-unread" ->
            AppChord (UnreadStep 1)

        "go-home" ->
            AppChord GoHome

        "go-date" ->
            AppChord GoJumpToDate

        "prefs" ->
            AppChord OpenPreferences

        "account" ->
            AppChord OpenAccount

        "mark-read" ->
            AppChord MarkConversationRead

        "dnd" ->
            AppChord ToggleDndChord

        "room-mute" ->
            AppChord ToggleRoomMute

        "room-star" ->
            AppChord ToggleRoomStar

        "attach" ->
            AppChord AttachFiles

        "schedule" ->
            AppChord ScheduleSend

        "export" ->
            AppChord ExportTranscript

        "follow" ->
            AppChord FollowToggle

        "single-keys-on" ->
            SingleKeys True

        "single-keys-off" ->
            SingleKeys False

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


{-| The help rows (oracle `SHORTCUTS`, every chord this client
handles and nothing else, so the sheet never advertises a dead key).
Single-character keys (`/`, `?`, J, K, N, U, G…) can be switched off
on this device (WCAG 2.1.4); the overlay carries that switch.
Ctrl+Shift+M / E / L belong to the call while one is live. -}
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

    -- v3/gap-commands: the oracle registry chords
    , { group = "Navigation"
      , rows =
            [ { chords = [ "Alt+↑", "⌥↑" ], description = "Previous room / DM" }
            , { chords = [ "Alt+↓", "⌥↓" ], description = "Next room / DM" }
            , { chords = [ "Alt+Shift+↑", "⌥⇧↑" ], description = "Previous unread room / DM" }
            , { chords = [ "Alt+Shift+↓", "⌥⇧↓" ], description = "Next unread room / DM" }
            , { chords = [ "N" ], description = "Jump to next unread room / DM" }
            , { chords = [ "G then H" ], description = "Go to Home" }
            , { chords = [ "G then D" ], description = "Open jump-to-date" }
            , { chords = [ "⌘⇧A", "Ctrl+Shift+A" ], description = "Open account" }
            , { chords = [ "Alt+S", "⌥S" ], description = "Focus the room list" }
            ]
      }
    , { group = "Chat"
      , rows =
            [ { chords = [ "Enter", "Alt+Enter" ], description = "Focus message composer" }
            , { chords = [ "J" ], description = "Move to next message" }
            , { chords = [ "K" ], description = "Move to previous message" }
            , { chords = [ "⌘F", "Ctrl+F" ], description = "Search messages" }
            , { chords = [ "⌘⇧E", "Ctrl+Shift+E" ], description = "Mark conversation read (outside calls)" }
            , { chords = [ "⌘B", "Ctrl+B" ], description = "Star / unstar room" }
            , { chords = [ "⌘⇧M", "Ctrl+Shift+M" ], description = "Mute / unmute room (outside calls)" }
            , { chords = [ "U" ], description = "Follow current room / DM" }
            , { chords = [ "⌘⇧U", "Ctrl+Shift+U" ], description = "Attach a file" }
            , { chords = [ "⌘⇧L", "Ctrl+Shift+L" ], description = "Schedule message to send later (outside calls)" }
            , { chords = [ "⌘⌥E", "Ctrl+Alt+E" ], description = "Export local transcript" }
            ]
      }
    , { group = "View"
      , rows =
            [ { chords = [ "⌘,", "Ctrl+," ], description = "Open preferences" }
            , { chords = [ "⌘⇧D", "Ctrl+Shift+D" ], description = "Toggle do not disturb" }
            , { chords = [ "Alt+M", "⌥M" ], description = "Show / hide member list" }
            ]
      }

    -- v3/calls-c11 (C12): active only in a live call, never while typing
    , { group = "Voice & Video"
      , rows = callShortcutRows
      }
    ]


{-| Call chords (spec §3.1). Every chord carries a modifier (WCAG
2.1.4). Provisional (§7.1): the microphone takes Ctrl+Shift+M; the
oracle's room-notification mute on that chord is not bound in this
client. v3/calls-c8: Captions is Ctrl/Cmd+Shift+C; push to talk is the
one single-key shortcut, user-bound in Voice settings (unset by default).
-}
callShortcutRows : List { chords : List String, description : String }
callShortcutRows =
    [ { chords = [ "⌘⇧M", "Ctrl+Shift+M" ], description = "Mute / unmute microphone" }
    , { chords = [ "⌘⇧E", "Ctrl+Shift+E" ], description = "Turn camera on / off" }
    , { chords = [ "⌘⇧H", "Ctrl+Shift+H" ], description = "Raise / lower hand" }
    -- v3/calls-c8
    , { chords = [ "⌘⇧C", "Ctrl+Shift+C" ], description = "Show / hide live captions" }
    , { chords = [ "⌘⇧L", "Ctrl+Shift+L" ], description = "Leave call (asks first with more than 2 people)" }
    , { chords = [ "⌘⇧G", "Ctrl+Shift+G" ], description = "Cycle layout: grid, spotlight, screen share" }
    , { chords = [ "⌘⇧F", "Ctrl+Shift+F" ], description = "Cycle call stage size" }
    , { chords = [ "⌘⇧S", "Ctrl+Shift+S" ], description = "Announce who is speaking" }
    , { chords = [ "Esc" ], description = "Exit fullscreen call stage" }
    -- v3/calls-c8: the ONLY single-key shortcut — off until you bind a
    -- key yourself in Voice settings (WCAG 2.1.4: user-chosen, remappable)
    , { chords = [ "Talk key" ], description = "Push to talk: hold the key you bind in Voice settings (off until set)" }
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
