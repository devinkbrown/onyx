module InviteShare exposing
    ( Sheet
    , contextCopy
    , copyBusyLabel
    , copyResultCopy
    , copyTag
    , fallbackCopy
    , introCopy
    , open
    , payload
    , shareText
    , shareTitle
    , tagChannel
    )

{-| v3/dmsafety — "Invite friends" share sheet core (mirroring
`shell/RoomInviteShare.tsx` + `lib/invite/shareRoomInvite.ts`).

Reuses `Invite.buildInviteLink` (`/invite/?join=`); never an IRC
INVITE. The copy round-trip rides the existing `ClipboardCopy` /
`ClipboardResult` outbound with a channel-stamped tag, so a result for
a sheet that has since closed or re-targeted is dropped.

Narrowing: the native `navigator.share` path has no port, so the sheet
always shows the oracle's copy-only fallback line.

-}

import Invite


type alias Sheet =
    { channel : String
    , status : String
    , busy : Bool
    }


{-| Open for a room (`""` = network-only invite). -}
open : String -> Sheet
open channel =
    { channel = String.trim channel, status = "", busy = False }


payload : { channel : String, network : String, origin : String, nowMs : Float } -> Invite.InviteLink
payload input =
    Invite.buildInviteLink
        { channel = input.channel
        , guestName = Nothing
        , at = Nothing
        , topic = Nothing
        , reader = False
        , inviter = Nothing
        , faces = []
        }
        { network = input.network, origin = input.origin, appOrigin = "/app/" }
        input.nowMs


shareTitle : String -> Invite.InviteLink -> String
shareTitle network link =
    case ( link.hasChannel, link.card.channel ) of
        ( True, Just ch ) ->
            "Join " ++ ch ++ " on " ++ network

        _ ->
            "Join " ++ network


shareText : String -> Invite.InviteLink -> String
shareText network link =
    case ( link.hasChannel, link.card.channel ) of
        ( True, Just ch ) ->
            "A friend invited you to " ++ ch ++ " on " ++ network ++ "."

        _ ->
            "A friend invited you to " ++ network ++ "."


introCopy : String
introCopy =
    "Send this link. Friends choose a name and request access."


contextCopy : Bool -> String
contextCopy connected =
    if connected then
        "Anyone with the link can open the invite. Room access rules still apply."

    else
        "You’re offline. You can still copy this link and share it."


fallbackCopy : String
fallbackCopy =
    "Sharing is not available here. Copy the link instead."


copyBusyLabel : Bool -> String
copyBusyLabel busy =
    if busy then
        "Copying link…"

    else
        "Copy link"


copyResultCopy : Bool -> String
copyResultCopy ok =
    if ok then
        "Invite link copied to clipboard."

    else
        "Copy failed. Select and copy the link shown above."


{-| Clipboard tag stamped with the sheet's target. -}
copyTag : String -> String
copyTag channel =
    "invite-share:" ++ channel


{-| The channel a clipboard tag was stamped for, if it is ours. -}
tagChannel : String -> Maybe String
tagChannel tag =
    if String.startsWith "invite-share:" tag then
        Just (String.dropLeft (String.length "invite-share:") tag)

    else
        Nothing
