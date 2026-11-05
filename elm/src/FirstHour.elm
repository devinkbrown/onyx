module FirstHour exposing
    ( CoachTip
    , Handoff
    , Landing(..)
    , coachTip
    , composerHint
    , inviteFriendsHref
    , record
    , seenKey
    , shouldFocusComposer
    , shouldShowHomeWelcome
    , shouldSuppressGuestClaim
    )

{-| First-hour decisions. Port of `src/lib/firstHour/firstHour.ts`.
Seen, focus, and the handoff are explicit arguments; the `onyx:first-hour-seen`
flag is written by the ports bridge.
-}

import Url


type Landing
    = Home
    | Room


type alias Handoff =
    { landing : Landing
    , channel : Maybe String
    , guest : Bool
    }


type alias CoachTip =
    { id : String
    , text : String
    }


seenKey : String
seenKey =
    "onyx:first-hour-seen"


homeTip : CoachTip
homeTip =
    { id = "home-next"
    , text = "Browse a room, start one, or invite a friend."
    }


roomTip : CoachTip
roomTip =
    { id = "room-say-hi"
    , text = "Say hi — type below and press Enter."
    }


record : { landing : Landing, channel : Maybe String, guest : Bool } -> Handoff
record input =
    { landing = input.landing
    , channel =
        input.channel
            |> Maybe.map String.trim
            |> Maybe.andThen
                (\channel ->
                    if String.isEmpty channel then
                        Nothing

                    else
                        Just channel
                )
    , guest = input.guest
    }


coachTip : Bool -> Maybe Handoff -> Landing -> Maybe CoachTip
coachTip seen handoff surface =
    if seen then
        Nothing

    else
        case handoff of
            Just current ->
                if not current.guest then
                    Nothing

                else
                    case ( surface, current.landing ) of
                        ( Home, Home ) ->
                            Just homeTip

                        ( Room, Room ) ->
                            Just roomTip

                        _ ->
                            Nothing

            Nothing ->
                Nothing


composerHint : Bool -> Maybe Handoff -> Maybe String
composerHint seen handoff =
    coachTip seen handoff Room |> Maybe.map .text


shouldSuppressGuestClaim : Bool -> Maybe Handoff -> Bool
shouldSuppressGuestClaim seen handoff =
    if seen then
        False

    else
        case handoff of
            Just current ->
                current.guest

            Nothing ->
                False


shouldShowHomeWelcome : { connected : Bool, hasRooms : Bool, directoryCount : Int, recentCount : Int } -> Bool
shouldShowHomeWelcome input =
    input.connected && not input.hasRooms && input.directoryCount == 0 && input.recentCount == 0


shouldFocusComposer : { focused : Bool, handoff : Maybe Handoff, activeChannel : Maybe String } -> Bool
shouldFocusComposer input =
    if input.focused then
        False

    else
        case input.handoff of
            Just handoff ->
                if handoff.landing /= Room then
                    False

                else
                    case ( handoff.channel, input.activeChannel |> Maybe.map String.trim ) of
                        ( Just wanted, Just active ) ->
                            not (String.isEmpty active) && String.toLower active == String.toLower wanted

                        _ ->
                            False

            Nothing ->
                False


inviteFriendsHref : Maybe String -> String
inviteFriendsHref channel =
    case channel |> Maybe.map String.trim |> Maybe.andThen emptyToNothing of
        Nothing ->
            "/invite/"

        Just room ->
            "/invite/?join=" ++ Url.percentEncode room


emptyToNothing : String -> Maybe String
emptyToNothing value =
    if String.isEmpty value then
        Nothing

    else
        Just value
