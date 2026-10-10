module Home exposing
    ( CaughtUpPlan
    , CaughtUpTarget
    , CoachTip(..)
    , EmptyIntro
    , Inbox
    , Kind(..)
    , Room
    , caughtUpAnnounce
    , catchUpSummary
    , coachText
    , coachTip
    , composeInbox
    , emptyRoomIntro
    , inboxAria
    , initials
    , markCaughtUpLabel
    , planCatchUpAll
    , projectRooms
    , quietDescription
    , roomCardAria
    , showFirstRoomPrompt
    , showInviteFriends
    , signalMessage
    , title
    , visibleName
    , welcomeLine
    )

{-| Pure Home briefing derivations, mirroring the oracle
`lib/catchup/markCaughtUp.ts` (plan + announce), `lib/catchup/homeInbox.ts`
(mentions / unread split, recency order), the `HomeBriefingView` copy
helpers (`inboxAria`, `kindVisibleName`, `initials`, title + quiet copy),
the `homeController` gates (`showFirstRoomPrompt`, `showInviteFriends`),
`lib/firstHour/firstHour.ts` (coach tips) and the `MessageView` empty-feed
intro. No `App` import: callers project their `Channel`s into `Room`s.
-}


{-| Conversation kind: a joined room or a DM peer. -}
type Kind
    = RoomKind
    | DmKind


{-| Minimal projection of a store conversation. `lastActivity` is the
newest row's stamp (0 when none); `hasBoundary` is whether an
authoritative first-unread id is known for it.
-}
type alias Room =
    { name : String
    , kind : Kind
    , unread : Int
    , highlights : Int
    , lastActivity : Int
    , hasBoundary : Bool
    }


type alias CaughtUpTarget =
    { kind : Kind
    , target : String
    , unread : Int
    , highlights : Int
    }


type alias CaughtUpPlan =
    { targets : List CaughtUpTarget
    , rooms : Int
    , unread : Int
    , mentions : Int
    }


{-| Project store conversations (newest row first) into `Room`s:
`isChannel` decides room vs DM, `hasBoundary` whether a first-unread
id is known.
-}
projectRooms :
    (String -> Bool)
    -> (String -> Bool)
    -> List { a | name : String, unread : Int, highlights : Int, messages : List { b | at : Int } }
    -> List Room
projectRooms isChannel hasBoundary convs =
    List.map
        (\c ->
            { name = c.name
            , kind =
                if isChannel c.name then
                    RoomKind

                else
                    DmKind
            , unread = c.unread
            , highlights = c.highlights
            , lastActivity = List.head c.messages |> Maybe.map .at |> Maybe.withDefault 0
            , hasBoundary = hasBoundary c.name
            }
        )
        convs


{-| Every conversation that still carries unread activity (unread OR
highlights), counters clamped at zero, ordered mentions first, then
most unread, then name A→Z (case-insensitive). Exactly the targets
"Mark all caught up" advances.
-}
planCatchUpAll : List Room -> CaughtUpPlan
planCatchUpAll rooms =
    let
        targets =
            rooms
                |> List.filter (\r -> r.unread > 0 || r.highlights > 0)
                |> List.map
                    (\r ->
                        { kind = r.kind
                        , target = r.name
                        , unread = max 0 r.unread
                        , highlights = max 0 r.highlights
                        }
                    )
                |> List.sortWith compareTargets
    in
    { targets = targets
    , rooms = List.length targets
    , unread = List.sum (List.map .unread targets)
    , mentions = List.sum (List.map .highlights targets)
    }


compareTargets : CaughtUpTarget -> CaughtUpTarget -> Order
compareTargets a b =
    case compare b.highlights a.highlights of
        EQ ->
            case compare b.unread a.unread of
                EQ ->
                    compare (String.toLower a.target) (String.toLower b.target)

                o ->
                    o

        o ->
            o


plural : Int -> String -> String -> String
plural n one many =
    if n == 1 then
        one

    else
        many


{-| Announce string for a completed "mark all caught up". -}
caughtUpAnnounce : CaughtUpPlan -> String
caughtUpAnnounce plan =
    if plan.rooms == 0 then
        "Already all caught up."

    else
        "Marked "
            ++ String.fromInt plan.rooms
            ++ " "
            ++ plural plan.rooms "room" "rooms"
            ++ " as caught up"
            ++ (if plan.mentions > 0 then
                    ", clearing " ++ String.fromInt plan.mentions ++ " " ++ plural plan.mentions "mention" "mentions"

                else
                    ""
               )
            ++ "."


{-| Accessible name of the mark-all button. -}
markCaughtUpLabel : CaughtUpPlan -> String
markCaughtUpLabel plan =
    "Mark all caught up — clears "
        ++ String.fromInt plan.unread
        ++ " unread across "
        ++ String.fromInt plan.rooms
        ++ " "
        ++ plural plan.rooms "room" "rooms"


{-| Signal-strip message: "N conversation(s) need(s) you". -}
signalMessage : CaughtUpPlan -> String
signalMessage plan =
    String.fromInt plan.rooms ++ " " ++ plural plan.rooms "conversation needs you" "conversations need you"


{-| Catch-up head summary: "N unread · M mention(s)". -}
catchUpSummary : CaughtUpPlan -> String
catchUpSummary plan =
    String.fromInt plan.unread
        ++ " unread"
        ++ (if plan.mentions > 0 then
                " · " ++ String.fromInt plan.mentions ++ " " ++ plural plan.mentions "mention" "mentions"

            else
                ""
           )


type alias Inbox =
    { mentions : List Room
    , missed : List Room
    , empty : Bool
    }


{-| Split conversations into mentions and unread (a mentioned room is
never listed twice), each newest-activity first then name A→Z.
-}
composeInbox : List Room -> Inbox
composeInbox rooms =
    let
        recency a b =
            case compare b.lastActivity a.lastActivity of
                EQ ->
                    compare a.name b.name

                o ->
                    o

        mentions =
            rooms |> List.filter (\r -> r.highlights > 0) |> List.sortWith recency

        missed =
            rooms |> List.filter (\r -> r.unread > 0 && r.highlights <= 0) |> List.sortWith recency
    in
    { mentions = mentions
    , missed = missed
    , empty = List.isEmpty mentions && List.isEmpty missed
    }


{-| Visible name: rooms drop their `#`/`&` sigil, DMs show the nick. -}
visibleName : Kind -> String -> String
visibleName kind name =
    case kind of
        DmKind ->
            name

        RoomKind ->
            dropSigil [ '#', '&' ] name


dropSigil : List Char -> String -> String
dropSigil sigils name =
    case String.uncons name of
        Just ( c, rest ) ->
            if List.member c sigils then
                rest

            else
                name

        Nothing ->
            name


{-| Avatar initial: first visible char uppercased, `?` when empty. -}
initials : String -> String
initials name =
    let
        visible =
            String.trim (dropSigil [ '#', '&', '@' ] name)
    in
    if String.isEmpty visible then
        "?"

    else
        String.toUpper (String.left 1 visible)


{-| Inbox row accessible name. -}
inboxAria : Room -> String
inboxAria row =
    "Open "
        ++ row.name
        ++ (if row.hasBoundary then
                " at your first unread message"

            else
                ""
           )
        ++ ", "
        ++ String.fromInt row.unread
        ++ " unread"
        ++ (if row.highlights > 0 then
                ", " ++ String.fromInt row.highlights ++ " " ++ plural row.highlights "mention" "mentions"

            else
                ""
           )


{-| Joined-room / DM card accessible name (distinct from the inbox
row so the two never collide). -}
roomCardAria : Room -> String
roomCardAria row =
    (case row.kind of
        RoomKind ->
            "Open room " ++ row.name

        DmKind ->
            "Open conversation with " ++ row.name
    )
        ++ (if row.unread > 0 then
                ", " ++ String.fromInt row.unread ++ " unread"

            else
                ""
           )
        ++ (if row.highlights > 0 then
                ", " ++ String.fromInt row.highlights ++ " " ++ plural row.highlights "mention" "mentions"

            else
                ""
           )


{-| Masthead title. -}
title : Inbox -> String
title inbox =
    if inbox.empty then
        "The room is quiet."

    else
        "What did you miss?"


{-| Greeting with the user's nick (the controller's `welcomeName`). -}
welcomeLine : String -> String
welcomeLine nick =
    let
        trimmed =
            String.trim nick
    in
    if String.isEmpty trimmed then
        "Welcome to Onyx"

    else
        "Welcome to Onyx, " ++ trimmed


{-| Quiet-state description. -}
quietDescription : { caughtUp : Bool, connected : Bool } -> String
quietDescription input =
    if input.caughtUp then
        "Nothing needs your attention right now."

    else if input.connected then
        "Find a room to join, or start one for your people."

    else
        "Reconnect to see live rooms, or use what is saved on this device."


{-| First-room prompt gate: connected with no rooms and an empty
directory.
-}
showFirstRoomPrompt : { connected : Bool, hasRooms : Bool, directoryCount : Int } -> Bool
showFirstRoomPrompt input =
    input.connected && not input.hasRooms && input.directoryCount == 0


{-| Invite-friends gate: connected and missing either rooms or DMs. -}
showInviteFriends : { connected : Bool, roomCount : Int, dmCount : Int } -> Bool
showInviteFriends input =
    input.connected && (input.roomCount == 0 || input.dmCount == 0)


type CoachTip
    = HomeNext
    | RoomSayHi


{-| One quiet tip for an unseen guest session: Home gets "home-next",
an empty room gets "room-say-hi". Signed-in users and a dismissed
coach get none.
-}
coachTip : { guest : Bool, dismissed : Bool, surface : CoachTip } -> Maybe CoachTip
coachTip input =
    if input.dismissed || not input.guest then
        Nothing

    else
        Just input.surface


coachText : CoachTip -> { id : String, text : String }
coachText tip =
    case tip of
        HomeNext ->
            { id = "home-next", text = "Browse a room, start one, or invite a friend." }

        RoomSayHi ->
            { id = "room-say-hi", text = "Say hi — type below and press Enter." }


type alias EmptyIntro =
    { title : String
    , body : String
    }


{-| Empty-feed intro: channels say "Say hi" during the first hour and
"Still waters here" otherwise; DMs carry the privacy copy.
-}
emptyRoomIntro : { kind : Kind, target : String, firstHour : Bool } -> EmptyIntro
emptyRoomIntro input =
    case input.kind of
        DmKind ->
            { title = "A private conversation"
            , body = "Encrypted DM messages are intended for you and the other person. Plaintext drafts and attachments can remain on this device and are not covered by the message encryption claim."
            }

        RoomKind ->
            if input.firstHour then
                { title = "Say hi", body = "Type a first message below to join the room." }

            else
                { title = "Still waters here", body = "Say the first thing in " ++ input.target ++ "." }
