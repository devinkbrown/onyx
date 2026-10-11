module RoomTransfer exposing
    ( Event(..)
    , Inbound
    , Verb(..)
    , applyInbound
    , handoverPlan
    , isRegisteredRoom
    , outboundSignals
    , parseSignal
    , roomTagKey
    , signalLine
    , transferTagKey
    , verbToString
    )

{-| v3/gap-people — room ownership handover that the other person can
actually see.

**What the server offers** (Onyx Server, read-only source):

  - `MODE #room +q <nick>` — an owner or founder grants the live owner
    rank at once (`chanmode.cascadeStatusOps`, rank-checked in
    `handleMode`). There is no "take" side: the recipient cannot claim
    it, and nothing waits for them.
  - `CHANNEL TRANSFER #room <account>` — for a **registered** room
    (`+r`), the registered founder hands the registration to another
    account (`services.transferChannel`: founder-only, the account must
    exist; reply `NOTICE … Channel #room founder transferred to …`,
    failures `FAIL CHANNEL ACCESS_DENIED|CHANNEL_UNKNOWN|…`). The new
    founder gets the founder rank on their next join.
  - Neither has an offer/accept step, and there is no server-side
    pending-transfer state.

**What the client adds**: the accept-to-take offer travels to the
recipient as a client-only tagged `TAGMSG` (relayed by the server to
anyone with `message-tags`):

    @+onyx/room-transfer=offer;+onyx/room=#room TAGMSG <recipient>

with `accept`, `decline` and `cancel` going the other way. Nothing
changes until the recipient accepts and the owner then hands over:
`CHANNEL TRANSFER` (registered rooms, when the recipient's account is
known) plus `MODE +q` for them and `-q` for the owner.

**Server gap** (documented, not worked around): offers live only in
the two clients' memory — they do not survive a reconnect, the
recipient must be online, and another client that does not understand
the tag never sees the offer. The owner keeps a Cancel button, and the
waiting copy says so.

-}

import Dict exposing (Dict)
import Stewardship exposing (RoomTransferOffer, StewardMember)
import Wire


type Verb
    = Offer
    | Accept
    | Decline
    | Cancel


transferTagKey : String
transferTagKey =
    "+onyx/room-transfer"


roomTagKey : String
roomTagKey =
    "+onyx/room"


verbToString : Verb -> String
verbToString verb =
    case verb of
        Offer ->
            "offer"

        Accept ->
            "accept"

        Decline ->
            "decline"

        Cancel ->
            "cancel"


verbFromString : String -> Maybe Verb
verbFromString raw =
    case raw of
        "offer" ->
            Just Offer

        "accept" ->
            Just Accept

        "decline" ->
            Just Decline

        "cancel" ->
            Just Cancel

        _ ->
            Nothing


{-| The outbound tagged TAGMSG for one signal. -}
signalLine : Verb -> { to : String, channel : String } -> String
signalLine verb input =
    Wire.formatTaggedLine
        (Dict.fromList [ ( transferTagKey, verbToString verb ), ( roomTagKey, String.trim input.channel ) ])
        "TAGMSG"
        [ String.trim input.to ]


{-| One inbound signal addressed to us. -}
type alias Inbound =
    { verb : Verb
    , channel : String
    , from : String
    }


validToken : Int -> String -> Bool
validToken maxLength value =
    not (String.isEmpty value)
        && String.length value <= maxLength
        && not (String.any (\c -> c <= ' ' || Char.toCode c == 127) value)
        && not (String.contains "," value)


{-| A `TAGMSG <us>` carrying both tags from someone else. -}
parseSignal : String -> Wire.IrcMessage -> Maybe Inbound
parseSignal ourNick message =
    case ( message.command, message.params, message.nick ) of
        ( "TAGMSG", [ target ], Just from ) ->
            if String.toLower target /= String.toLower ourNick || String.toLower from == String.toLower ourNick then
                Nothing

            else
                case ( Dict.get transferTagKey message.tags |> Maybe.andThen verbFromString, Dict.get roomTagKey message.tags ) of
                    ( Just verb, Just channel ) ->
                        if validToken 200 channel && (String.startsWith "#" channel || String.startsWith "&" channel) && validToken 256 from then
                            Just { verb = verb, channel = channel, from = from }

                        else
                            Nothing

                    _ ->
                        Nothing

        _ ->
            Nothing


{-| What an inbound signal did, for the toast / inbox copy. -}
type Event
    = OfferReceived { channel : String, from : String }
    | OfferAccepted { channel : String, by : String }
    | OfferDeclined { channel : String, by : String }
    | OfferCancelled { channel : String, by : String }


{-| Apply an inbound signal to the offer memory. `members` is the
current roster of `signal.channel` (empty when we are not in it).
Signals that do not match a live, consistent offer change nothing. -}
applyInbound :
    { ourNick : String, members : List StewardMember }
    -> Inbound
    -> Dict String RoomTransferOffer
    -> ( Dict String RoomTransferOffer, Maybe Event )
applyInbound ctx signal offers =
    let
        key =
            Stewardship.channelKey signal.channel

        current =
            Dict.get key offers

        same a b =
            Stewardship.nickKey a == Stewardship.nickKey b

        unchanged =
            ( offers, Nothing )
    in
    case signal.verb of
        Offer ->
            let
                weAreHere =
                    Stewardship.findMember ctx.members ctx.ourNick /= Nothing

                ownOffer =
                    case current of
                        Just offer ->
                            same offer.from ctx.ourNick

                        Nothing ->
                            False
            in
            if
                not weAreHere
                    || not (Stewardship.actorIsOwner ctx.members signal.from)
                    || Stewardship.actorIsOwner ctx.members ctx.ourNick
                    || ownOffer
            then
                unchanged

            else
                ( Dict.insert key
                    { channel = signal.channel
                    , from = Stewardship.visibleNick signal.from
                    , to = Stewardship.visibleNick ctx.ourNick
                    , accepted = False
                    }
                    offers
                , Just (OfferReceived { channel = signal.channel, from = signal.from })
                )

        Accept ->
            case current of
                Just offer ->
                    if same offer.from ctx.ourNick && same offer.to signal.from && not offer.accepted then
                        ( Dict.insert key { offer | accepted = True } offers
                        , Just (OfferAccepted { channel = offer.channel, by = signal.from })
                        )

                    else
                        unchanged

                Nothing ->
                    unchanged

        Decline ->
            case current of
                Just offer ->
                    if same offer.from ctx.ourNick && same offer.to signal.from then
                        ( Dict.remove key offers, Just (OfferDeclined { channel = offer.channel, by = signal.from }) )

                    else
                        unchanged

                Nothing ->
                    unchanged

        Cancel ->
            case current of
                Just offer ->
                    if same offer.to ctx.ourNick && same offer.from signal.from then
                        ( Dict.remove key offers, Just (OfferCancelled { channel = offer.channel, by = signal.from }) )

                    else
                        unchanged

                Nothing ->
                    unchanged


{-| The signals a local offer change implies (the caller runs this only
for the user's own Room care actions, never for inbound lines, so a
received decline is never answered). `granted` marks a completed
handover: the MODE lines tell the recipient, so no signal is sent. -}
outboundSignals :
    { ourNick : String, granted : Bool }
    -> Dict String RoomTransferOffer
    -> Dict String RoomTransferOffer
    -> List { verb : Verb, to : String, channel : String }
outboundSignals ctx before after =
    let
        same a b =
            Stewardship.nickKey a == Stewardship.nickKey b

        keys =
            Dict.keys before ++ List.filter (\k -> not (Dict.member k before)) (Dict.keys after)

        forKey key =
            case ( Dict.get key before, Dict.get key after ) of
                ( Nothing, Just next ) ->
                    if same next.from ctx.ourNick && not next.accepted then
                        [ { verb = Offer, to = next.to, channel = next.channel } ]

                    else
                        []

                ( Just prior, Nothing ) ->
                    if ctx.granted then
                        []

                    else if same prior.from ctx.ourNick then
                        [ { verb = Cancel, to = prior.to, channel = prior.channel } ]

                    else if same prior.to ctx.ourNick then
                        [ { verb = Decline, to = prior.from, channel = prior.channel } ]

                    else
                        []

                ( Just prior, Just next ) ->
                    if prior == next then
                        []

                    else if same next.from ctx.ourNick && not (same prior.to next.to) then
                        (if same prior.from ctx.ourNick then
                            [ { verb = Cancel, to = prior.to, channel = prior.channel } ]

                         else
                            []
                        )
                            ++ [ { verb = Offer, to = next.to, channel = next.channel } ]

                    else if same next.to ctx.ourNick && next.accepted && not prior.accepted then
                        [ { verb = Accept, to = next.from, channel = next.channel } ]

                    else
                        []

                ( Nothing, Nothing ) ->
                    []
    in
    List.concatMap forKey keys


{-| Registered rooms carry the live `+r` (REGISTERED) flag. -}
isRegisteredRoom : List Char -> Bool
isRegisteredRoom flags =
    List.member 'r' flags


{-| What the owner sends when handing over an accepted offer, beyond
the MODE lines `Stewardship.transferModeCommands` already plans:
`CHANNEL TRANSFER` when the room is registered and the recipient's
account is known. The note explains what moves. -}
handoverPlan :
    { registered : Bool, room : String, recipient : String, recipientAccount : Maybe String }
    -> { lines : List String, note : String }
handoverPlan input =
    case ( input.registered, input.recipientAccount ) of
        ( True, Just account ) ->
            { lines = [ Wire.formatIrcLine "CHANNEL" [ "TRANSFER", input.room, account ] ]
            , note = "The registration moves to " ++ account ++ " and " ++ input.recipient ++ " becomes an owner now."
            }

        ( True, Nothing ) ->
            { lines = []
            , note = input.recipient ++ " is not signed in, so only the live owner rank moves. The registration stays with you."
            }

        ( False, _ ) ->
            { lines = []
            , note = "This room is not registered, so the handover is the live owner rank only. It lasts while the room is open."
            }
