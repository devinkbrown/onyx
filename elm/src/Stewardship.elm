module Stewardship exposing
    ( RoomTransferOffer
    , StewardDecision(..)
    , StewardMember
    , TransferModeCommand
    , acceptTransfer
    , actorIsOwner
    , canAddCoAdmin
    , canCompleteTransfer
    , canDeleteRoom
    , channelKey
    , closeTitle
    , declineTransfer
    , deleteTitle
    , findMember
    , isCoAdminModes
    , isConsumerStewardshipRoom
    , isOwnerModes
    , isUsableNick
    , lastMemberLeaveDissolves
    , listCoAdmins
    , listOwners
    , maxCoAdmins
    , memberCount
    , membersCanInvite
    , minRoomSize
    , maxRoomSize
    , nickKey
    , offerTransfer
    , rejectThirdCoAdmin
    , stewardshipCopy
    , transferFor
    , transferModeCommands
    , typedNameMatchesRoom
    , visibleNick
    , writeTransfer
    )

{-| Consumer room care for 3–30 person rooms — Elm port of the pure
logic in `src/lib/rooms/roomStewardship.ts` (plus the Dict-based
memory from `roomTransferMemory.ts`).

Locked product shape: exactly one owner, 0–2 co-admins, members can
invite at this size, transfer is accept-to-take (not a random
successor), owner-only close or delete, last member leaving
dissolves.

Ownership is the existing roster status: founder `Q` / owner `q`,
co-admins are `o`. No new server command. Founder `Q` is
creation-only and cannot be stripped by MODE — after accept we send
`+q` / `-q`.

Modes ride as plain letter strings at this boundary; the caller maps
the roster `Set Char` through `String.fromChar`.
-}

import Dict exposing (Dict)


{-| One roster row as stewardship sees it. -}
type alias StewardMember =
    { nick : String
    , modes : List String
    }


{-| An in-session accept-to-take offer. Not persisted — just enough
memory so MODE +q waits for accept. -}
type alias RoomTransferOffer =
    { channel : String
    , from : String
    , to : String
    , accepted : Bool
    }


{-| One MODE line of the ownership handover. -}
type alias TransferModeCommand =
    { modes : String
    , nick : String
    }


{-| An action verdict: the usable nick on success, the status copy on
refusal (mirroring `StewardshipResult`). -}
type StewardDecision
    = StewardOk String
    | StewardRefused String


minRoomSize : Int
minRoomSize =
    3


maxRoomSize : Int
maxRoomSize =
    30


maxCoAdmins : Int
maxCoAdmins =
    2


{-| User-visible copy, verbatim with the oracle `STEWARDSHIP_COPY`. -}
stewardshipCopy :
    { title : String
    , blurb : String
    , thirdCoAdmin : String
    , transferWait : String
    , transferGrant : String
    , transferNoTake : String
    , founderNote : String
    , closeConfirm : String
    , closeBody : String
    , deleteConfirm : String
    , deleteBody : String
    , lastMember : String
    , inviteHint : String
    }
stewardshipCopy =
    { title = "Room care"
    , blurb = "One owner. Up to two people who can help. Members can invite."
    , thirdCoAdmin = "This room already has two people who can help."
    , transferWait = "They have to accept before the room changes hands."
    , transferGrant = "They accepted. Hand the room over now."
    , transferNoTake = "The server cannot let them take the room by themselves. After they accept, the current owner still sends the existing owner rank."
    , founderNote = "The first-person rank cannot be removed. After they accept, we send the existing owner rank."
    , closeConfirm = "Close room"
    , closeBody = "Locks the door. People already here can stay. This is not a delete."
    , deleteConfirm = "Delete room"
    , deleteBody = "Type the room name to delete it. This cannot be undone here."
    , lastMember = "You are the last person. Leaving dissolves this room."
    , inviteHint = "Anyone in a room this size can invite."
    }


closeTitle : String -> String
closeTitle room =
    "Close " ++ room ++ "?"


deleteTitle : String -> String
deleteTitle room =
    "Delete " ++ room ++ "?"


channelKey : String -> String
channelKey name =
    String.toLower (String.trim name)


nickKey : String -> String
nickKey nick =
    String.toLower (String.trim nick)


isNickCharValid : Char -> Bool
isNickCharValid char =
    let
        code =
            Char.toCode char
    in
    char /= ' '
        && char /= ','
        && code > 0x1F
        && code /= 0x7F


isUsableNick : String -> Bool
isUsableNick nick =
    let
        trimmed =
            String.trim nick
    in
    not (String.isEmpty trimmed)
        && String.length trimmed <= 64
        && String.all isNickCharValid trimmed


visibleNick : String -> String
visibleNick nick =
    String.trim nick


memberCount : List StewardMember -> Int
memberCount members =
    List.length (List.filter (\member -> isUsableNick member.nick) members)


isConsumerStewardshipRoom : Int -> Bool
isConsumerStewardshipRoom count =
    count >= minRoomSize && count <= maxRoomSize


membersCanInvite : Int -> Bool
membersCanInvite count =
    isConsumerStewardshipRoom count


lastMemberLeaveDissolves : Int -> Bool
lastMemberLeaveDissolves count =
    count == 1


isOwnerModes : List String -> Bool
isOwnerModes modes =
    List.member "Q" modes || List.member "q" modes


isCoAdminModes : List String -> Bool
isCoAdminModes modes =
    List.member "o" modes && not (isOwnerModes modes)


dedupedNames : (StewardMember -> Bool) -> List StewardMember -> List String
dedupedNames qualifies members =
    List.foldl
        (\member ( seen, names ) ->
            if not (isUsableNick member.nick) || not (qualifies member) then
                ( seen, names )

            else
                let
                    key =
                        nickKey member.nick
                in
                if List.member key seen then
                    ( seen, names )

                else
                    ( key :: seen, names ++ [ visibleNick member.nick ] )
        )
        ( [], [] )
        members
        |> Tuple.second


listOwners : List StewardMember -> List String
listOwners members =
    dedupedNames (\member -> isOwnerModes member.modes) members


listCoAdmins : List StewardMember -> List String
listCoAdmins members =
    dedupedNames (\member -> isCoAdminModes member.modes) members


findMember : List StewardMember -> String -> Maybe StewardMember
findMember members nick =
    let
        key =
            nickKey nick
    in
    List.head (List.filter (\member -> nickKey member.nick == key) members)


actorIsOwner : List StewardMember -> String -> Bool
actorIsOwner members nick =
    case findMember members nick of
        Just member ->
            isOwnerModes member.modes

        Nothing ->
            False


canAddCoAdmin : List String -> Bool
canAddCoAdmin coAdmins =
    List.length coAdmins < maxCoAdmins


rejectThirdCoAdmin : List StewardMember -> String -> String -> StewardDecision
rejectThirdCoAdmin members actor candidate =
    if not (actorIsOwner members actor) then
        StewardRefused "Only the owner can add someone who can help."

    else if not (isUsableNick candidate) then
        StewardRefused "That name is not a person in this room."

    else
        case findMember members candidate of
            Nothing ->
                StewardRefused "That person is not in this room."

            Just member ->
                if isOwnerModes member.modes then
                    StewardRefused "The owner already looks after this room."

                else if isCoAdminModes member.modes then
                    StewardRefused "They already help with this room."

                else if not (canAddCoAdmin (listCoAdmins members)) then
                    StewardRefused stewardshipCopy.thirdCoAdmin

                else
                    StewardOk (visibleNick member.nick)


canCompleteTransfer : Maybe RoomTransferOffer -> Bool
canCompleteTransfer offer =
    case offer of
        Just current ->
            current.accepted

        Nothing ->
            False


stripOnePrefix : String -> String
stripOnePrefix name =
    case String.uncons name of
        Just ( '#', rest ) ->
            rest

        Just ( '&', rest ) ->
            rest

        _ ->
            name


typedNameMatchesRoom : String -> String -> Bool
typedNameMatchesRoom typed room =
    let
        got =
            String.trim typed

        want =
            String.trim room
    in
    if String.isEmpty got || String.isEmpty want then
        False

    else if channelKey got == channelKey want then
        True

    else
        let
            gotBare =
                stripOnePrefix got

            wantBare =
                stripOnePrefix want
        in
        not (String.isEmpty gotBare)
            && channelKey gotBare == channelKey wantBare


canDeleteRoom : { actorIsOwner : Bool, typedName : String, room : String } -> Bool
canDeleteRoom input =
    input.actorIsOwner && typedNameMatchesRoom input.typedName input.room


offerTransfer :
    { current : Maybe RoomTransferOffer
    , channel : String
    , from : String
    , to : String
    , members : List StewardMember
    }
    -> Maybe RoomTransferOffer
offerTransfer input =
    if not (isUsableNick input.from) || not (isUsableNick input.to) then
        Nothing

    else if nickKey input.from == nickKey input.to then
        Nothing

    else if not (actorIsOwner input.members input.from) then
        Nothing

    else if findMember input.members input.to == Nothing then
        Nothing

    else
        case input.current of
            Just current ->
                if channelKey current.channel == channelKey input.channel && not current.accepted then
                    if nickKey current.from == nickKey input.from && nickKey current.to == nickKey input.to then
                        Just current

                    else
                        Just
                            { channel = String.trim input.channel
                            , from = visibleNick input.from
                            , to = visibleNick input.to
                            , accepted = False
                            }

                else
                    Just
                        { channel = String.trim input.channel
                        , from = visibleNick input.from
                        , to = visibleNick input.to
                        , accepted = False
                        }

            Nothing ->
                Just
                    { channel = String.trim input.channel
                    , from = visibleNick input.from
                    , to = visibleNick input.to
                    , accepted = False
                    }


acceptTransfer :
    { current : Maybe RoomTransferOffer
    , channel : String
    , acceptor : String
    }
    -> Maybe RoomTransferOffer
acceptTransfer input =
    case input.current of
        Nothing ->
            Nothing

        Just offer ->
            if channelKey offer.channel /= channelKey input.channel then
                Nothing

            else if nickKey offer.to /= nickKey input.acceptor then
                Nothing

            else if offer.accepted then
                Just offer

            else
                Just { offer | accepted = True }


declineTransfer :
    { current : Maybe RoomTransferOffer
    , channel : String
    , actor : String
    }
    -> Maybe RoomTransferOffer
declineTransfer input =
    case input.current of
        Nothing ->
            Nothing

        Just offer ->
            if channelKey offer.channel /= channelKey input.channel then
                Just offer

            else
                let
                    actor =
                        nickKey input.actor
                in
                if actor /= nickKey offer.to && actor /= nickKey offer.from then
                    Just offer

                else
                    Nothing


transferModeCommands : Maybe RoomTransferOffer -> List StewardMember -> Maybe { commands : List TransferModeCommand, founderRemains : Bool }
transferModeCommands offer members =
    case offer of
        Nothing ->
            Nothing

        Just current ->
            if not current.accepted then
                Nothing

            else
                case findMember members current.to of
                    Nothing ->
                        Nothing

                    Just to ->
                        case findMember members current.from of
                            Just prior ->
                                Just
                                    { commands =
                                        [ { modes = "+q", nick = visibleNick to.nick } ]
                                            ++ (if List.member "q" prior.modes then
                                                    [ { modes = "-q", nick = visibleNick prior.nick } ]

                                                else
                                                    []
                                               )
                                    , founderRemains = List.member "Q" prior.modes
                                    }

                            Nothing ->
                                Just
                                    { commands = [ { modes = "+q", nick = visibleNick to.nick } ]
                                    , founderRemains = False
                                    }


{-| Offer memory keyed by channel (mirroring `writeRoomTransfer`:
replacing any offer for the channel, dropping it on `Nothing`). -}
writeTransfer : Maybe RoomTransferOffer -> String -> Dict String RoomTransferOffer -> Dict String RoomTransferOffer
writeTransfer next channel offers =
    let
        key =
            channelKey channel
    in
    case next of
        Nothing ->
            Dict.remove key offers

        Just offer ->
            Dict.insert key offer offers


{-| The live offer for a channel (mirroring `transferFor`). -}
transferFor : String -> Dict String RoomTransferOffer -> Maybe RoomTransferOffer
transferFor channel offers =
    Dict.get (channelKey channel) offers
