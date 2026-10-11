module Sidebar exposing
    ( Sections
    , SectionsInput
    , activityStamp
    , badgeText
    , channelActivityMs
    , compareDmRecency
    , dmActivityMs
    , dmAriaLabel
    , dmPreview
    , dmPreviewText
    , dmSealedPreview
    , filterEmptyCopy
    , hasAttention
    , isFilterActive
    , isStarred
    , matchesQuery
    , normalizeQuery
    , offlineStamp
    , roomAriaLabel
    , sections
    , sortRooms
    , unreadLabel
    )

{-| Pure sectioned-sidebar derivation, mirroring the `ChannelSidebar`
memos plus `lib/channel/sidebarFilter.ts`, `lib/channel/messagesInbox.ts`
and the `latestDmListPreview` half of `lib/e2ee/dmPrivacyChrome.ts`.

Sections: Favorites (starred rooms, alpha), Rooms (the unstarred
remainder, alpha) and Messages (DMs, newest activity first, nick as the
tie-break). The filter is a case-insensitive substring over room names
and DM nicks plus an optional unread-only attention gate; an empty
query passes everything.

Narrowings: this derivation knows no channel folders, hidden rooms or
closed conversations (v3/gap-organize applies them in `View.Rail`), so
every room it is given lands in Favorites or Rooms and every DM lists.
Room activity reads the newest buffered row (the oracle keeps a
separate `channelLastActivity` map).

-}

import App exposing (Channel, ChatMessage)
import DmCipher
import Set exposing (Set)


{-| What the sidebar needs from the model, kept explicit so the
derivation stays testable without a full `Model`. -}
type alias SectionsInput =
    { isChannel : String -> Bool
    , starred : Set String
    , query : String
    , unreadOnly : Bool
    }


type alias Sections =
    { favorites : List Channel
    , rooms : List Channel
    , dms : List Channel
    , roomsJoined : Int
    , filterActive : Bool
    , filterEmpty : Bool
    }


{-| Trim + lower (mirroring `normalizeSidebarQuery`). -}
normalizeQuery : String -> String
normalizeQuery raw =
    String.toLower (String.trim raw)


{-| Case-insensitive substring match; an empty query matches all. -}
matchesQuery : String -> String -> Bool
matchesQuery query name =
    let
        q =
            normalizeQuery query
    in
    String.isEmpty q || String.contains q (String.toLower name)


{-| Unread badge or mention highlight counts as attention. -}
hasAttention : Channel -> Bool
hasAttention channel =
    channel.unread > 0 || channel.highlights > 0


{-| The filter is "on" with a non-blank query or the unread-only
gate. -}
isFilterActive : String -> Bool -> Bool
isFilterActive query unreadOnly =
    not (String.isEmpty (String.trim query)) || unreadOnly


{-| Starred under the lowered key or the raw name (the oracle checks
both). -}
isStarred : Set String -> String -> Bool
isStarred starred name =
    Set.member (String.toLower name) starred || Set.member name starred


passes : SectionsInput -> Channel -> Bool
passes input channel =
    (not input.unreadOnly || hasAttention channel)
        && matchesQuery input.query channel.name


{-| Alpha by name, case-insensitively, raw name as the tie-break
(standing in for `localeCompare`). -}
sortRooms : List Channel -> List Channel
sortRooms =
    List.sortWith
        (\a b ->
            case compare (String.toLower a.name) (String.toLower b.name) of
                EQ ->
                    compare a.name b.name

                other ->
                    other
        )


{-| Newest stamp across the buffered rows and `lastSeen`, 0 when
unknown (mirroring `messagesInboxActivityMs`). -}
dmActivityMs : Channel -> Int
dmActivityMs channel =
    List.foldl
        (\message best -> max best message.at)
        (max 0 (Maybe.withDefault 0 channel.lastSeen))
        channel.messages


{-| Newest buffered row stamp for a room, 0 when none. -}
channelActivityMs : Channel -> Int
channelActivityMs channel =
    List.foldl (\message best -> max best message.at) 0 channel.messages


{-| Newer activity first; nick alpha (case-insensitive) only when
recency ties (mirroring `compareMessagesInboxRecency`). Unread is not
a rank key. -}
compareDmRecency : Channel -> Channel -> Order
compareDmRecency a b =
    case compare (dmActivityMs b) (dmActivityMs a) of
        EQ ->
            compare (String.toLower a.name) (String.toLower b.name)

        other ->
            other


{-| Split the conversation map into the three sidebar sections. -}
sections : SectionsInput -> List Channel -> Sections
sections input conversations =
    let
        ( roomsAll, dmsAll ) =
            List.partition (\c -> input.isChannel c.name) conversations

        visibleRooms =
            sortRooms (List.filter (passes input) roomsAll)

        ( favorites, rooms ) =
            List.partition (\c -> isStarred input.starred c.name) visibleRooms

        dms =
            dmsAll
                |> List.filter (passes input)
                |> List.sortWith compareDmRecency

        active =
            isFilterActive input.query input.unreadOnly
    in
    { favorites = favorites
    , rooms = rooms
    , dms = dms
    , roomsJoined = List.length roomsAll
    , filterActive = active
    , filterEmpty = active && List.isEmpty visibleRooms && List.isEmpty dms
    }


{-| Copy for a filter that hides everything. -}
filterEmptyCopy : String -> Bool -> String
filterEmptyCopy query unreadOnly =
    let
        trimmed =
            String.trim query
    in
    if unreadOnly && String.isEmpty trimmed then
        "Nothing unread right now."

    else
        "No rooms or messages match “"
            ++ (if String.isEmpty trimmed then
                    "unread"

                else
                    trimmed
               )
            ++ "”."


{-| Badge text: mentions win; otherwise the unread count capped at
`99+`; nothing when quiet. -}
badgeText : Channel -> Maybe String
badgeText channel =
    if channel.highlights > 0 then
        Just (String.fromInt channel.highlights)

    else if channel.unread > 99 then
        Just "99+"

    else if channel.unread > 0 then
        Just (String.fromInt channel.unread)

    else
        Nothing


{-| Accessible unread suffix (`, 3 unread, 1 mention`). -}
unreadLabel : Int -> Int -> String
unreadLabel unread highlights =
    let
        parts =
            (if unread > 0 then
                [ String.fromInt unread ++ " unread" ]

             else
                []
            )
                ++ (if highlights > 0 then
                        [ String.fromInt highlights
                            ++ (if highlights == 1 then
                                    " mention"

                                else
                                    " mentions"
                               )
                        ]

                    else
                        []
                   )
    in
    if List.isEmpty parts then
        ""

    else
        ", " ++ String.join ", " parts


{-| Calm pending-memo stamp for a DM row (`1 offline` / `N offline`,
empty when none). -}
offlineStamp : Int -> String
offlineStamp count =
    if count <= 0 then
        ""

    else if count == 1 then
        "1 offline"

    else
        String.fromInt count ++ " offline"


{-| Room row name: label, attention, favorite. -}
roomAriaLabel : Channel -> Bool -> String
roomAriaLabel channel starred =
    channel.name
        ++ unreadLabel channel.unread channel.highlights
        ++ (if starred then
                ", favorite"

            else
                ""
           )


{-| DM row name: peer, preview, key change, attention, offline memos. -}
dmAriaLabel : Channel -> { preview : Maybe String, keyChanged : Bool, offline : Int } -> String
dmAriaLabel channel extra =
    "DM with "
        ++ channel.name
        ++ (case extra.preview of
                Just p ->
                    ", " ++ p

                Nothing ->
                    ""
           )
        ++ (if extra.keyChanged then
                ", device key changed"

            else
                ""
           )
        ++ unreadLabel channel.unread channel.highlights
        ++ (if extra.offline > 0 then
                ", " ++ String.fromInt extra.offline ++ " offline"

            else
                ""
           )


{-| Compact relative stamp: `now` · `4m` · `2h` · `3d`; empty when the
stamp is unknown (0). Float math keeps millisecond stamps exact. -}
activityStamp : Float -> Int -> String
activityStamp nowMs atMs =
    if atMs <= 0 then
        ""

    else
        let
            sec =
                max 0 (toFloat (floor ((nowMs - toFloat atMs) / 1000)))

            unit size =
                String.fromInt (floor (sec / size))
        in
        if sec < 60 then
            "now"

        else if sec < 3600 then
            unit 60 ++ "m"

        else if sec < 86400 then
            unit 3600 ++ "h"

        else
            unit 86400 ++ "d"


dmSealedPreview : String
dmSealedPreview =
    "Encrypted message"


systemTypes : List String
systemTypes =
    [ "join", "part", "quit", "kick", "mode", "topic", "nick", "system", "error" ]


collapseSpace : String -> String
collapseSpace text =
    String.join " " (String.words text)


{-| One row's list preview (mirroring `dmListPreviewText`): deleted,
redacted, pending and system rows yield nothing; sealed bodies stay
"Encrypted message" (never the envelope); long text clips at 96. -}
dmPreviewText : ChatMessage -> Maybe String
dmPreviewText message =
    if message.deleted || message.redacted || message.pending then
        Nothing

    else if List.member message.msgType systemTypes then
        Nothing

    else if App.messageLocked message then
        Just dmSealedPreview

    else
        let
            text =
                collapseSpace (Maybe.withDefault message.body message.plaintext)
        in
        if String.isEmpty text then
            if message.msgType == "action" then
                Just "Action message"

            else
                Just "Message"

        else if text == DmCipher.lockedPlaceholder || DmCipher.isEnvelope text then
            Just dmSealedPreview

        else if String.length text <= 96 then
            Just text

        else
            Just (String.left 95 text ++ "…")


{-| Newest previewable row (rows are buffered newest-first). -}
dmPreview : Channel -> Maybe String
dmPreview channel =
    firstJust dmPreviewText channel.messages


firstJust : (a -> Maybe b) -> List a -> Maybe b
firstJust fn items =
    case items of
        [] ->
            Nothing

        x :: rest ->
            case fn x of
                Just y ->
                    Just y

                Nothing ->
                    firstJust fn rest
