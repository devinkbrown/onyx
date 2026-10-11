module UserModes exposing
    ( Ctx
    , DeferCheck(..)
    , Effect(..)
    , Held
    , Memo
    , Msg(..)
    , Offline
    , PrivacyGroup(..)
    , PrivacyMode
    , Request
    , Seen
    , State
    , Status
    , Whowas
    , agoText
    , deferSubmit
    , heldPending
    , ignoreAdded
    , ignoreRemoved
    , lastSeenLine
    , offlineFor
    , serverOnlyBlocks
    , silencedOnServer
    , acceptAddLine
    , acceptListLine
    , acceptRemoveLine
    , autojoinLine
    , blank
    , clearOwned
    , deferAtLine
    , deferCronLine
    , deferCheck
    , deferCheckCopy
    , deferMaxBytes
    , decodeStored
    , encodeStored
    , foldWire
    , heldFor
    , isImplemented
    , maskForNick
    , maxRealnameLength
    , memoLine
    , memoMaxLength
    , modeAvailable
    , modeLine
    , modeOn
    , modePending
    , modeQueryLine
    , onConnected
    , onDisconnected
    , parseMemoNotice
    , privacyModes
    , realnameShown
    , seenLine
    , setnameLine
    , silenceAddLine
    , silenceFull
    , silenceListLine
    , silenceRemoveLine
    , silencedNick
    , update
    , utf8Bytes
    , whowasLine
    , wireToken
    )

{-| v3/gap-usermodes — the pure core for the "you on the network" gaps
of `elm/design/SERVER_FEATURE_MAP.md` §22 P1 items 10, 12, 13, 14, 15,
19 and 21:

  - privacy user modes (`MODE <me> ±X`, seeded by 221 and the live
    MODE echoes, re-applied after every fresh connect);
  - caller-id (`+g`): the ACCEPT list, 716/717 for the sender, 718
    message requests for the recipient;
  - server-side blocks (`SILENCE +nick!*@*`, 271/272, the echo);
  - the offline-message mailbox (`MEMO …` and its `MEMO:` NOTICEs);
  - server-held scheduled messages (`DEFER AT`), which the server can
    never cancel;
  - account-wide autojoin (`AUTOJOIN ADD|DEL|LIST`);
  - profile depth: `SETNAME`, `WHOWAS <nick> 1` and `SEEN <account>`.

Wire shapes are the Onyx Server's (`/home/kain/onyx-server`, read-only):
every reply this module folds is quoted next to its parser. App owns the
glue (`-- v3/gap-usermodes` blocks): it builds a `Ctx`, applies `Effect`s
and decides which lines this module consumes.

-}

import Dict exposing (Dict)
import Json.Decode as Decode
import Json.Encode as Encode
import Modes
import Services
import Set exposing (Set)
import Wire



-- ── privacy modes ─────────────────────────────────────────────────────


type PrivacyGroup
    = Messages
    | Visibility
    | Advanced


type alias PrivacyMode =
    { letter : Char
    , key : String
    , group : PrivacyGroup
    , title : String
    , description : String
    }


{-| The user modes the server both accepts from a client
(`usermode.zig` `default_specs`, `client_writable`) AND enforces
somewhere. `+D` (deaf) is client-writable and advertised in 004, but
nothing in `src/daemon` reads it, so it is deliberately absent: a
switch that changes nothing would lie. `+B` (bot) and `+H` (hide-oper)
are not privacy choices for people, and `+j` is an oper privilege.

Enforcement sites (server.zig): R `:59479` (477), C `:59487`
(`FAIL PRIVMSG CTCP_BLOCKED`), g `:59499` (716/717/718), i `:24111`
(WHO/ISON for strangers), p `:24636` (WHOIS channel list), P `:53939`
(media EVENT presence), Q `:22574` (`+f` forwards).

-}
privacyModes : List PrivacyMode
privacyModes =
    [ { letter = 'R'
      , key = "regonly"
      , group = Messages
      , title = "Only signed-in people can message me"
      , description = "Guests without an Onyx account can't start a DM with you."
      }
    , { letter = 'g'
      , key = "approve"
      , group = Messages
      , title = "Approve new conversations"
      , description = "People you haven't approved can't DM you. Each request shows up in your Inbox, and you decide."
      }
    , { letter = 'C'
      , key = "noctcp"
      , group = Messages
      , title = "Block app pings"
      , description = "Stops automatic version, time and ping checks sent to your app. /me actions still arrive."
      }
    , { letter = 'i'
      , key = "invisible"
      , group = Visibility
      , title = "Invisible to strangers"
      , description = "People who don't share a room with you won't find you in user lists or name checks."
      }
    , { letter = 'p'
      , key = "hiderooms"
      , group = Visibility
      , title = "Hide my rooms"
      , description = "Your profile won't list the rooms you're in."
      }
    , { letter = 'P'
      , key = "hidecalls"
      , group = Visibility
      , title = "Keep calls quiet"
      , description = "Joining, leaving, muting and speaking in voice rooms isn't announced. Others may not see you in the call list."
      }
    , { letter = 'Q'
      , key = "noforward"
      , group = Advanced
      , title = "Never redirect me"
      , description = "When a room sends visitors elsewhere, show me why I can't join instead of moving me."
      }
    ]


{-| In the privacy catalog and settable by the user themself
(`Modes.userModeAccess`: `SelfOnly`, or `SelfAndOper` for `+P`).
-}
isImplemented : Char -> Bool
isImplemented letter =
    List.any (\m -> m.letter == letter) privacyModes
        && (case Modes.userModeAccess letter of
                Just Modes.SelfOnly ->
                    True

                Just Modes.SelfAndOper ->
                    True

                _ ->
                    False
           )


{-| Offered when implemented and (once 004 arrived) advertised. -}
modeAvailable : State -> Char -> Bool
modeAvailable state letter =
    isImplemented letter
        && (case state.advertised of
                Just letters ->
                    Set.member letter letters

                Nothing ->
                    True
           )


modeOn : State -> Char -> Bool
modeOn state letter =
    case Dict.get letter state.pending of
        Just wanted ->
            wanted

        Nothing ->
            Set.member letter state.modes


modePending : State -> Char -> Bool
modePending state letter =
    Dict.member letter state.pending



-- ── state ─────────────────────────────────────────────────────────────


type alias Status =
    { text : String
    , error : Bool
    }


type alias Request =
    { nick : String
    , atMs : Float
    }


type alias Memo =
    { from : String
    , text : String
    , atMs : Float
    }


{-| One server-held `DEFER AT` send. The server has no LIST and no
CANCEL (`handleDefer` `server.zig:38762`), so this local copy is only a
memory aid: it can't be cancelled and it is never re-sent.
-}
type alias Held =
    { channel : String
    , text : String
    , sendAt : Int
    , account : String
    }


type alias Whowas =
    { nick : String
    , realname : Maybe String
    , account : Maybe String
    , signoffSecs : Maybe Int
    , found : Bool
    }


type alias Seen =
    { account : String
    , lastSeenMs : Maybe Int
    , lastLoginMs : Maybe Int
    , found : Bool
    }


type alias State =
    { -- privacy modes
      modes : Set Char
    , modesKnown : Bool
    , advertised : Maybe (Set Char)
    , wanted : Set Char
    , pending : Dict Char Bool
    , reassert : Bool
    , modeStatus : Maybe Status

    -- caller-id
    , accepts : List String
    , acceptBuffer : List String
    , acceptLoading : Bool
    , acceptKnown : Bool
    , acceptDraft : String
    , acceptStatus : Maybe Status
    , requests : List Request
    , requestsUnseen : Int
    , notedAt : Dict String Float

    -- server blocks
    , serverIgnore : Bool
    , silenced : List String
    , silenceBuffer : List String
    , silenceLoading : Bool
    , silenceKnown : Bool
    , silenceStatus : Maybe Status

    -- offline messages
    , memoOpen : Bool
    , memoWaiting : List Memo
    , memoBuffer : List Memo
    , memoListing : Bool
    , memoKnown : Bool
    , memoDelivered : List Memo
    , memoForward : Maybe String
    , memoForwardKnown : Bool
    , memoIgnores : List String
    , memoIgnoreBuffer : List String
    , memoIgnoreListing : Bool
    , memoTo : String
    , memoText : String
    , memoForwardDraft : String
    , memoIgnoreDraft : String
    , memoSending : Bool
    , memoClearAsk : Bool
    , memoStatus : Maybe Status

    -- server-held schedules
    , deferServer : Bool
    , deferInflight : List Held
    , deferSentAt : Float
    , deferHeld : List Held

    -- account autojoin
    , autojoins : List String
    , autojoinBuffer : List String
    , autojoinListing : Bool
    , autojoinKnown : Bool
    , autojoinDraft : String
    , autojoinStatus : Maybe Status

    -- profile depth
    , realname : String
    , realnameLive : Maybe String
    , realnameDraft : Maybe String
    , realnameStatus : Maybe Status
    , whowas : Dict String Whowas
    , whowasPending : Maybe String
    , whowasBuffer : Maybe Whowas
    , seen : Dict String Seen
    , seenPending : List String
    , seenDetail : Bool
    }


blank : State
blank =
    { modes = Set.empty
    , modesKnown = False
    , advertised = Nothing
    , wanted = Set.empty
    , pending = Dict.empty
    , reassert = False
    , modeStatus = Nothing
    , accepts = []
    , acceptBuffer = []
    , acceptLoading = False
    , acceptKnown = False
    , acceptDraft = ""
    , acceptStatus = Nothing
    , requests = []
    , requestsUnseen = 0
    , notedAt = Dict.empty
    , serverIgnore = False
    , silenced = []
    , silenceBuffer = []
    , silenceLoading = False
    , silenceKnown = False
    , silenceStatus = Nothing
    , memoOpen = False
    , memoWaiting = []
    , memoBuffer = []
    , memoListing = False
    , memoKnown = False
    , memoDelivered = []
    , memoForward = Nothing
    , memoForwardKnown = False
    , memoIgnores = []
    , memoIgnoreBuffer = []
    , memoIgnoreListing = False
    , memoTo = ""
    , memoText = ""
    , memoForwardDraft = ""
    , memoIgnoreDraft = ""
    , memoSending = False
    , memoClearAsk = False
    , memoStatus = Nothing
    , deferServer = False
    , deferInflight = []
    , deferSentAt = 0
    , deferHeld = []
    , autojoins = []
    , autojoinBuffer = []
    , autojoinListing = False
    , autojoinKnown = False
    , autojoinDraft = ""
    , autojoinStatus = Nothing
    , realname = ""
    , realnameLive = Nothing
    , realnameDraft = Nothing
    , realnameStatus = Nothing
    , whowas = Dict.empty
    , whowasPending = Nothing
    , whowasBuffer = Nothing
    , seen = Dict.empty
    , seenPending = []
    , seenDetail = False
    }


{-| What App tells the core about the live session. -}
type alias Ctx =
    { nick : String
    , account : Maybe String
    , live : Bool
    , nowMs : Float
    , silenceLimit : Int
    , ignored : Set String
    , isChannel : String -> Bool

    -- lower-case nicks whose profile (WHOIS sheet) is open: a 401 for one
    -- of them means "offline", which is when WHOWAS/SEEN are worth asking.
    , profileNicks : Set String

    -- the open DM conversations, newest first (a thunk: only the "approve
    -- people I already message" button needs it, not every inbound line).
    , dmPeers : () -> List String

    -- the prefix 001 named as the server (a dotless server name is only
    -- trusted as a server once it did).
    , serverPrefix : Maybe String

    -- would plaintext to this person bypass an encrypted conversation?
    -- (a memo is plain text stored on the server, so it obeys the same
    -- guard as a raw `/memo send`.)
    , leaks : String -> Bool
    }


type Effect
    = Send String
    | Persist
    | Toast { title : String, body : String, error : Bool }
    | DmNote { peer : String, text : String }
    | DeliverMemo { from : String, text : String }
    | DeferSettled { ok : Bool, held : Held, error : String }
    | OpenDm String
    | OpenPrivacy
    | ForgetDeviceAutojoin String
    | FocusId String



-- ── persistence (`onyx:usermodes`) ────────────────────────────────────


maxHeld : Int
maxHeld =
    20


maxApproveBatch : Int
maxApproveBatch =
    24


pluralize : Int -> String -> String -> String
pluralize n one many =
    if n == 1 then
        one

    else
        many


maxRealnameLength : Int
maxRealnameLength =
    100


encodeStored : State -> String
encodeStored state =
    Encode.encode 0
        (Encode.object
            [ ( "v", Encode.int 1 )
            , ( "wanted", Encode.string (String.fromList (Set.toList state.wanted)) )
            , ( "serverIgnore", Encode.bool state.serverIgnore )
            , ( "realname", Encode.string state.realname )
            , ( "held"
              , Encode.list
                    (\h ->
                        Encode.object
                            [ ( "channel", Encode.string h.channel )
                            , ( "text", Encode.string h.text )
                            , ( "sendAt", Encode.int h.sendAt )
                            , ( "account", Encode.string h.account )
                            ]
                    )
                    state.deferHeld
              )
            ]
        )


{-| Fail-closed load: unknown letters, oversized names and malformed
rows drop; anything unreadable leaves the defaults.
-}
decodeStored : Decode.Value -> State -> State
decodeStored raw state =
    let
        field name dec =
            Decode.decodeValue (Decode.field name dec) raw |> Result.toMaybe

        wanted =
            field "wanted" Decode.string
                |> Maybe.withDefault ""
                |> String.toList
                |> List.filter isImplemented
                |> Set.fromList

        heldDecoder =
            Decode.map4 Held
                (Decode.field "channel" Decode.string)
                (Decode.field "text" Decode.string)
                (Decode.field "sendAt" Decode.int)
                (Decode.field "account" Decode.string)

        held =
            field "held" (Decode.list (Decode.oneOf [ Decode.map Just heldDecoder, Decode.succeed Nothing ]))
                |> Maybe.withDefault []
                |> List.filterMap identity
                |> List.filter (\h -> wireToken h.channel /= Nothing && not (String.isEmpty h.text) && h.sendAt > 0)
                |> List.take maxHeld
    in
    { state
        | wanted = wanted
        , serverIgnore = field "serverIgnore" Decode.bool |> Maybe.withDefault False
        , realname = cleanRealname (field "realname" Decode.string |> Maybe.withDefault "") |> Maybe.withDefault ""
        , deferHeld = held
    }


cleanRealname : String -> Maybe String
cleanRealname raw =
    let
        trimmed =
            String.trim (String.filter (\c -> Char.toCode c >= 0x20 && Char.toCode c /= 0x7F) raw)
    in
    if String.length trimmed > maxRealnameLength then
        Nothing

    else
        Just trimmed


{-| What the profile shows as your name right now. -}
realnameShown : State -> String -> String
realnameShown state nick =
    case state.realnameLive of
        Just live ->
            live

        Nothing ->
            if String.isEmpty state.realname then
                nick ++ " (webchat)"

            else
                state.realname



-- ── wire builders (server shapes) ─────────────────────────────────────


{-| A single wire token: non-empty, no spaces/controls/commas, no
leading colon, bounded.
-}
wireToken : String -> Maybe String
wireToken raw =
    let
        value =
            String.trim raw
    in
    if
        String.isEmpty value
            || String.length value > 128
            || String.any (\c -> c <= ' ' || Char.toCode c == 127 || c == ',') value
            || String.startsWith ":" value
    then
        Nothing

    else
        Just value


modeQueryLine : String -> Maybe String
modeQueryLine nick =
    Maybe.map (\n -> Wire.formatIrcLine "MODE" [ n ]) (wireToken nick)


{-| `MODE <me> +ab-c` — only implemented letters. -}
modeLine : String -> List Char -> List Char -> Maybe String
modeLine nick adds removes =
    let
        keep =
            List.filter isImplemented

        a =
            keep adds

        r =
            keep removes

        modeStr =
            (if List.isEmpty a then
                ""

             else
                "+" ++ String.fromList a
            )
                ++ (if List.isEmpty r then
                        ""

                    else
                        "-" ++ String.fromList r
                   )
    in
    if String.isEmpty modeStr then
        Nothing

    else
        Maybe.map (\n -> Wire.formatIrcLine "MODE" [ n, modeStr ]) (wireToken nick)


{-| `ACCEPT +nick` — the sign is glued to the nick (`accept_list.zig`
`parseOne`); `ACCEPT + nick` is a 461.
-}
acceptAddLine : String -> Maybe String
acceptAddLine nick =
    Maybe.map (\n -> Wire.formatIrcLine "ACCEPT" [ "+" ++ n ]) (wireToken nick)


acceptRemoveLine : String -> Maybe String
acceptRemoveLine nick =
    Maybe.map (\n -> Wire.formatIrcLine "ACCEPT" [ "-" ++ n ]) (wireToken nick)


acceptListLine : String
acceptListLine =
    Wire.formatIrcLine "ACCEPT" [ "*" ]


maskForNick : String -> Maybe String
maskForNick nick =
    Maybe.map (\n -> n ++ "!*@*") (wireToken nick)


{-| `SILENCE +mask` (`silence.zig` `parseOperationWith`: sign glued). -}
silenceAddLine : String -> Maybe String
silenceAddLine mask =
    Maybe.map (\m -> Wire.formatIrcLine "SILENCE" [ "+" ++ m ]) (wireToken mask)


silenceRemoveLine : String -> Maybe String
silenceRemoveLine mask =
    Maybe.map (\m -> Wire.formatIrcLine "SILENCE" [ "-" ++ m ]) (wireToken mask)


silenceListLine : String
silenceListLine =
    Wire.formatIrcLine "SILENCE" []


{-| The nick a `nick!*@*` mask names, if it is that shape. -}
silencedNick : String -> Maybe String
silencedNick mask =
    if String.endsWith "!*@*" mask then
        let
            nick =
                String.dropRight 4 mask
        in
        if String.isEmpty nick || String.contains "*" nick || String.contains "?" nick then
            Nothing

        else
            Just nick

    else
        Nothing


silenceFull : Ctx -> State -> Bool
silenceFull ctx state =
    ctx.silenceLimit > 0 && List.length state.silenced >= ctx.silenceLimit


memoMaxLength : Int
memoMaxLength =
    400


{-| `MEMO` lines (`handleMemo` `server.zig:52990`), through `Services.memo`.
A bare `FORWARD` asks for the current target; the 400-character cap and the
one-line rule are checked here before the text goes to the builder.
-}
memoLine : List String -> Maybe String
memoLine args =
    case args of
        [ "FORWARD" ] ->
            Just (Wire.formatIrcLine "MEMO" [ "FORWARD" ])

        [ "SEND", account, text ] ->
            cleanText memoMaxLength text
                |> Maybe.andThen (\t -> Services.memo "SEND" [ account, t ])

        sub :: rest ->
            Services.memo sub rest

        [] ->
            Nothing


cleanText : Int -> String -> Maybe String
cleanText limit raw =
    let
        t =
            String.trim raw
    in
    if String.isEmpty t || String.length t > limit || String.any (\c -> c == '\r' || c == '\n' || Char.toCode c == 0) t then
        Nothing

    else
        Just t


deferMaxBytes : Int
deferMaxBytes =
    400


{-| `DEFER AT <unix-ms> <#channel> :<text>` (`handleDefer`). -}
deferAtLine : Int -> String -> String -> Maybe String
deferAtLine sendAt channel text =
    if sendAt <= 0 then
        Nothing

    else
        case ( wireToken channel, cleanText 100000 text ) of
            ( Just c, Just t ) ->
                if utf8Bytes t > deferMaxBytes then
                    Nothing

                else
                    Just (Wire.formatIrcLine "DEFER" [ "AT", String.fromInt sendAt, c, t ])

            _ ->
                Nothing


{-| `DEFER CRON <min> <hour> <dom> <mon> <dow> <#channel> :<text>`
(`handleDefer`): the same send, repeating. The wire shape is covered here but
no control offers it: the server has no way to cancel a job, so a recurring
send that was a mistake would repeat for good.
-}
deferCronLine : String -> String -> String -> Maybe String
deferCronLine cron channel text =
    let
        fields =
            String.words cron

        fieldOk field =
            not (String.isEmpty field) && String.all (\c -> Char.isDigit c || c == '*' || c == '/' || c == ',' || c == '-') field
    in
    if List.length fields /= 5 || not (List.all fieldOk fields) then
        Nothing

    else
        case ( wireToken channel, cleanText 100000 text ) of
            ( Just c, Just t ) ->
                if utf8Bytes t > deferMaxBytes then
                    Nothing

                else
                    Just (Wire.formatIrcLine "DEFER" ([ "CRON" ] ++ fields ++ [ c, t ]))

            _ ->
                Nothing


autojoinLine : String -> Maybe String -> Maybe String
autojoinLine sub channel =
    case ( sub, channel ) of
        ( "LIST", Nothing ) ->
            Services.autojoin "LIST" []

        ( "ADD", Just c ) ->
            wireToken c |> Maybe.andThen (\t -> Services.autojoin "ADD" [ t ])

        ( "DEL", Just c ) ->
            wireToken c |> Maybe.andThen (\t -> Services.autojoin "DEL" [ t ])

        _ ->
            Nothing


setnameLine : String -> Maybe String
setnameLine name =
    Maybe.andThen
        (\clean ->
            if String.isEmpty clean then
                Nothing

            else
                Just (Wire.formatIrcLine "SETNAME" [ clean ])
        )
        (cleanRealname name)


{-| `WHOWAS <nick> 1` — the newest record only. -}
whowasLine : String -> Maybe String
whowasLine nick =
    Maybe.map (\n -> Wire.formatIrcLine "WHOWAS" [ n, "1" ]) (wireToken nick)


seenLine : String -> Maybe String
seenLine account =
    Services.seen account


utf8Bytes : String -> Int
utf8Bytes text =
    String.foldl
        (\c acc ->
            let
                code =
                    Char.toCode c
            in
            acc
                + (if code < 0x80 then
                    1

                   else if code < 0x0800 then
                    2

                   else if code < 0x00010000 then
                    3

                   else
                    4
                  )
        )
        0
        text



-- ── server-held schedule eligibility ──────────────────────────────────


type DeferCheck
    = DeferOk
    | DeferNeedsAccount
    | DeferOffline
    | DeferRoomOnly
    | DeferNotMember
    | DeferEncrypted
    | DeferEmpty
    | DeferMultiline
    | DeferTooLong


{-| Can this draft wait on the server? Mirrors `handleDefer`'s own
refusals (channel only, member only, ≤400 bytes, one line) plus the
product rule that only signed-in people get server-held sends.
-}
deferCheck :
    { signedIn : Bool
    , live : Bool
    , isChannel : Bool
    , member : Bool
    , encrypted : Bool
    , text : String
    }
    -> DeferCheck
deferCheck input =
    let
        body =
            String.trim input.text
    in
    if not input.signedIn then
        DeferNeedsAccount

    else if not input.live then
        DeferOffline

    else if not input.isChannel then
        DeferRoomOnly

    else if not input.member then
        DeferNotMember

    else if input.encrypted then
        DeferEncrypted

    else if String.isEmpty body || String.startsWith "/" body then
        DeferEmpty

    else if String.contains "\n" body || String.contains "\u{000D}" body then
        DeferMultiline

    else if utf8Bytes body > deferMaxBytes then
        DeferTooLong

    else
        DeferOk


{-| Why the server can't hold this draft, in a few plain words. -}
deferCheckCopy : DeferCheck -> String
deferCheckCopy check =
    case check of
        DeferOk ->
            ""

        DeferNeedsAccount ->
            "Sign in to use this."

        DeferOffline ->
            "Connect to use this."

        DeferRoomOnly ->
            "Rooms only."

        DeferNotMember ->
            "Join the room first."

        DeferEncrypted ->
            "Not for encrypted rooms."

        DeferEmpty ->
            "Write a message first."

        DeferMultiline ->
            "One line only."

        DeferTooLong ->
            "Up to 400 bytes."


heldFor : Maybe String -> State -> List Held
heldFor account state =
    case account of
        Just a ->
            List.filter (\h -> String.toLower h.account == String.toLower a) state.deferHeld

        Nothing ->
            []



-- ── connection lifecycle ──────────────────────────────────────────────


{-| A fresh 001: ask for the authoritative modes (the 221 re-applies
what the person turned on from this browser) and re-apply the saved
real name.
-}
onConnected : Ctx -> State -> ( State, List Effect )
onConnected ctx state =
    let
        fresh =
            { state
                | modes = Set.empty
                , modesKnown = False
                , pending = Dict.empty
                , reassert = True
                , accepts = []
                , acceptKnown = False
                , acceptLoading = False
                , silenced = []
                , silenceKnown = False
                , silenceLoading = False
                , memoListing = False
                , memoIgnoreListing = False
                , autojoins = []
                , autojoinKnown = False
                , autojoinListing = False
                , deferInflight = []
                , realnameLive = Nothing
                , whowasPending = Nothing
                , whowasBuffer = Nothing
                , seenPending = []
                , seenDetail = False
            }

        query =
            modeQueryLine ctx.nick |> Maybe.map Send |> maybeToList

        name =
            if String.isEmpty state.realname then
                []

            else
                setnameLine state.realname |> Maybe.map Send |> maybeToList
    in
    ( fresh, query ++ name )


{-| Forget what the previous owner chose on this browser (an account
switch): the server-side lists are theirs too and are asked for again.
-}
clearOwned : State -> State
clearOwned state =
    { state
        | wanted = Set.empty
        , serverIgnore = False
        , realname = ""
        , deferServer = False
        , deferHeld = []
        , deferInflight = []
        , accepts = []
        , acceptKnown = False
        , silenced = []
        , silenceKnown = False
        , autojoins = []
        , autojoinKnown = False
        , memoWaiting = []
        , memoKnown = False
        , memoForward = Nothing
        , memoForwardKnown = False
        , memoIgnores = []
    }


onDisconnected : State -> State
onDisconnected state =
    { state
        | pending = Dict.empty
        , memoSending = False
        , memoListing = False
        , acceptLoading = False
        , silenceLoading = False
        , autojoinListing = False
        , deferInflight = []
        , whowasPending = Nothing
        , seenPending = []
    }



-- ── update ────────────────────────────────────────────────────────────


type Msg
    = Loaded Decode.Value
    | ToggleMode Char
    | AcceptDraft String
    | AcceptAdd
    | AcceptRemove String
    | AcceptRefresh
    | AcceptExistingDms
    | RequestAccept String
    | RequestDismiss String
    | RequestsSeen
    | ServerIgnoreSet Bool
    | SilenceSyncAll
    | SilenceRemove String
    | SilenceRefresh
    | MemoOpen
    | MemoClose
    | MemoRefresh
    | MemoClearAsk
    | MemoClearCancel
    | MemoClearConfirm
    | MemoTo String
    | MemoText String
    | MemoSend
    | MemoForwardDraft String
    | MemoForwardSet
    | MemoForwardOff
    | MemoIgnoreDraft String
    | MemoIgnoreAdd
    | MemoIgnoreRemove String
    | MemoOpenDm String
    | DeferChoose Bool
    | AutojoinRefresh
    | AutojoinDraft String
    | AutojoinAddDraft
    | AutojoinAdd String
    | AutojoinRemove String
    | RealnameEdit
    | RealnameInput String
    | RealnameSave
    | RealnameCancel
    | RealnameReset
    | ProfileLookup { nick : String, account : Maybe String }
    | OpenPrivacyPanel


update : Ctx -> Msg -> State -> ( State, List Effect )
update ctx msg state =
    case msg of
        Loaded raw ->
            let
                loaded =
                    decodeStored raw state

                pruned =
                    { loaded | deferHeld = List.filter (heldStillPending ctx.nowMs) loaded.deferHeld }
            in
            if ctx.live then
                let
                    ( modesFixed, modeEffects ) =
                        reassertModes ctx pruned

                    nameEffects =
                        if String.isEmpty modesFixed.realname || modesFixed.realnameLive /= Nothing then
                            []

                        else
                            sends [ setnameLine modesFixed.realname ]

                    blockEffects =
                        if modesFixed.serverIgnore && ctx.account /= Nothing && not modesFixed.silenceKnown then
                            [ Send silenceListLine ]

                        else
                            []
                in
                ( modesFixed, modeEffects ++ nameEffects ++ blockEffects )

            else
                ( pruned, [] )

        ToggleMode letter ->
            toggleMode ctx letter state

        AcceptDraft value ->
            ( { state | acceptDraft = value, acceptStatus = Nothing }, [] )

        AcceptAdd ->
            case wireToken state.acceptDraft of
                Nothing ->
                    ( { state | acceptStatus = Just { text = "Enter a name with no spaces.", error = True } }, [] )

                Just nick ->
                    if not ctx.live then
                        ( { state | acceptStatus = offlineStatus }, [] )

                    else
                        approve nick { state | acceptDraft = "" }

        AcceptRemove nick ->
            if not ctx.live then
                ( { state | acceptStatus = offlineStatus }, [] )

            else
                ( { state
                    | accepts = List.filter (\n -> String.toLower n /= String.toLower nick) state.accepts
                    , acceptStatus = Just { text = nick ++ " needs your approval again to message you.", error = False }
                  }
                , sends [ acceptRemoveLine nick, Just acceptListLine ]
                )

        AcceptRefresh ->
            if ctx.live then
                ( { state | acceptLoading = True, acceptBuffer = [] }, [ Send acceptListLine ] )

            else
                ( state, [] )

        AcceptExistingDms ->
            if not ctx.live then
                ( { state | acceptStatus = offlineStatus }, [] )

            else
                let
                    have =
                        Set.fromList (List.map String.toLower state.accepts)

                    fresh =
                        ctx.dmPeers ()
                            |> List.filter (\n -> not (Set.member (String.toLower n) have) && n /= "" && not (ctx.isChannel n))
                            |> List.take maxApproveBatch
                in
                if List.isEmpty fresh then
                    ( { state | acceptStatus = Just { text = "Everyone you message is already approved.", error = False } }, [] )

                else
                    ( { state
                        | accepts = state.accepts ++ fresh
                        , acceptStatus = Just { text = "Approved " ++ String.fromInt (List.length fresh) ++ " " ++ pluralize (List.length fresh) "person" "people" ++ " you already message.", error = False }
                      }
                    , List.filterMap (acceptAddLine >> Maybe.map Send) fresh ++ [ Send acceptListLine ]
                    )

        RequestAccept nick ->
            if not ctx.live then
                ( { state | acceptStatus = offlineStatus }, [] )

            else
                let
                    ( approved, effects ) =
                        approve nick state
                in
                ( approved
                , effects
                    ++ [ Toast { title = "Approved " ++ nick, body = "They can message you now. Anything they sent before wasn't kept, so they may need to send it again.", error = False } ]
                )

        RequestDismiss nick ->
            ( { state | requests = List.filter (\r -> String.toLower r.nick /= String.toLower nick) state.requests }, [] )

        RequestsSeen ->
            ( { state | requestsUnseen = 0 }, [] )

        ServerIgnoreSet on ->
            ( { state
                | serverIgnore = on
                , silenceStatus = Nothing
              }
            , Persist
                :: (if on && ctx.live && not state.silenceKnown then
                        [ Send silenceListLine ]

                    else
                        []
                   )
            )

        SilenceSyncAll ->
            if not ctx.live then
                ( { state | silenceStatus = offlineStatus }, [] )

            else
                let
                    have =
                        Set.fromList (List.map String.toLower state.silenced)

                    room =
                        if ctx.silenceLimit > 0 then
                            max 0 (ctx.silenceLimit - List.length state.silenced)

                        else
                            64

                    missing =
                        ctx.ignored
                            |> Set.toList
                            |> List.filterMap maskForNick
                            |> List.filter (\m -> not (Set.member (String.toLower m) have))

                    taken =
                        List.take room missing

                    left =
                        List.length missing - List.length taken
                in
                ( { state
                    | silenceStatus =
                        Just
                            { text =
                                if List.isEmpty missing then
                                    "Everyone on your list is already blocked on the server."

                                else if left > 0 then
                                    "Blocked " ++ String.fromInt (List.length taken) ++ " on the server. The server list is full, so " ++ String.fromInt left ++ " stay device-only."

                                else
                                    "Blocked " ++ String.fromInt (List.length taken) ++ " on the server."
                            , error = left > 0
                            }
                  }
                , List.filterMap (silenceAddLine >> Maybe.map Send) taken
                )

        SilenceRemove mask ->
            if not ctx.live then
                ( { state | silenceStatus = offlineStatus }, [] )

            else
                ( state, sends [ silenceRemoveLine mask ] )

        SilenceRefresh ->
            if ctx.live then
                ( { state | silenceLoading = True, silenceBuffer = [] }, [ Send silenceListLine ] )

            else
                ( state, [] )

        MemoOpen ->
            let
                opened =
                    { state | memoOpen = True, memoStatus = Nothing, memoClearAsk = False }
            in
            if ctx.live && ctx.account /= Nothing then
                ( { opened | memoListing = True, memoBuffer = [], memoIgnoreListing = True, memoIgnoreBuffer = [] }
                , sends [ memoLine [ "LIST" ], memoLine [ "FORWARD" ], memoLine [ "IGNORE", "LIST" ] ]
                )

            else
                ( opened, [] )

        MemoClose ->
            ( { state | memoOpen = False, memoClearAsk = False }, [] )

        MemoRefresh ->
            if ctx.live && ctx.account /= Nothing then
                ( { state | memoListing = True, memoBuffer = [], memoStatus = Nothing }, sends [ memoLine [ "LIST" ] ] )

            else
                ( { state | memoStatus = offlineStatus }, [] )

        MemoClearAsk ->
            ( { state | memoClearAsk = True }, [] )

        MemoClearCancel ->
            ( { state | memoClearAsk = False }, [] )

        MemoClearConfirm ->
            if ctx.live then
                ( { state | memoClearAsk = False }, sends [ memoLine [ "CLEAR" ] ] )

            else
                ( { state | memoClearAsk = False, memoStatus = offlineStatus }, [] )

        MemoTo value ->
            ( { state | memoTo = value }, [] )

        MemoText value ->
            ( { state | memoText = String.left memoMaxLength value }, [] )

        MemoSend ->
            if not ctx.live then
                ( { state | memoStatus = offlineStatus }, [] )

            else
                case ( wireToken state.memoTo, cleanText memoMaxLength state.memoText ) of
                    ( Nothing, _ ) ->
                        ( { state | memoStatus = Just { text = "Enter the account name to leave a message for.", error = True } }, [] )

                    ( _, Nothing ) ->
                        ( { state | memoStatus = Just { text = "Write a message first (up to " ++ String.fromInt memoMaxLength ++ " characters, one line).", error = True } }, [] )

                    ( Just to, Just text ) ->
                        if ctx.leaks to then
                            ( { state | memoStatus = Just { text = "You have an encrypted conversation with " ++ to ++ ". Offline messages are plain text the server stores, so Onyx won't send this one. Message them in the conversation instead.", error = True } }
                            , []
                            )

                        else
                            ( { state | memoSending = True, memoStatus = Nothing }, sends [ memoLine [ "SEND", to, text ] ] )

        MemoForwardDraft value ->
            ( { state | memoForwardDraft = value }, [] )

        MemoForwardSet ->
            case wireToken state.memoForwardDraft of
                Nothing ->
                    ( { state | memoStatus = Just { text = "Enter the account to forward to.", error = True } }, [] )

                Just account ->
                    if ctx.live then
                        ( { state | memoForwardDraft = "" }, sends [ memoLine [ "FORWARD", account ] ] )

                    else
                        ( { state | memoStatus = offlineStatus }, [] )

        MemoForwardOff ->
            if ctx.live then
                ( state, sends [ memoLine [ "FORWARD", "OFF" ] ] )

            else
                ( { state | memoStatus = offlineStatus }, [] )

        MemoIgnoreDraft value ->
            ( { state | memoIgnoreDraft = value }, [] )

        MemoIgnoreAdd ->
            case wireToken state.memoIgnoreDraft of
                Nothing ->
                    ( { state | memoStatus = Just { text = "Enter the account to block.", error = True } }, [] )

                Just account ->
                    if ctx.live then
                        ( { state | memoIgnoreDraft = "", memoIgnoreListing = True, memoIgnoreBuffer = [] }
                        , sends [ memoLine [ "IGNORE", "ADD", account ], memoLine [ "IGNORE", "LIST" ] ]
                        )

                    else
                        ( { state | memoStatus = offlineStatus }, [] )

        MemoIgnoreRemove account ->
            if ctx.live then
                ( { state | memoIgnoreListing = True, memoIgnoreBuffer = [] }
                , sends [ memoLine [ "IGNORE", "DEL", account ], memoLine [ "IGNORE", "LIST" ] ]
                )

            else
                ( { state | memoStatus = offlineStatus }, [] )

        MemoOpenDm from ->
            ( { state | memoOpen = False }, [ OpenDm from ] )

        DeferChoose server ->
            ( { state | deferServer = server }, [] )

        AutojoinRefresh ->
            if ctx.live && ctx.account /= Nothing then
                ( { state | autojoinListing = True, autojoinBuffer = [] }, sends [ autojoinLine "LIST" Nothing ] )

            else
                ( state, [] )

        AutojoinDraft value ->
            ( { state | autojoinDraft = String.left 64 value, autojoinStatus = Nothing }, [] )

        AutojoinAddDraft ->
            case normalizeRoom state.autojoinDraft of
                Nothing ->
                    ( { state | autojoinStatus = Just { text = "Enter a room name like #lounge.", error = True } }, [] )

                Just channel ->
                    update ctx (AutojoinAdd channel) { state | autojoinDraft = "" }

        AutojoinAdd channel ->
            if ctx.live && ctx.account /= Nothing then
                ( { state | autojoinListing = True, autojoinBuffer = [], autojoinStatus = Nothing }
                , sends [ autojoinLine "ADD" (Just channel), autojoinLine "LIST" Nothing ]
                )

            else
                ( { state | autojoinStatus = offlineStatus }, [] )

        AutojoinRemove channel ->
            if ctx.live && ctx.account /= Nothing then
                ( { state
                    | autojoinListing = True
                    , autojoinBuffer = []
                    , autojoins = List.filter (\c -> String.toLower c /= String.toLower channel) state.autojoins
                    , autojoinStatus = Nothing
                  }
                , sends [ autojoinLine "DEL" (Just channel), autojoinLine "LIST" Nothing ]
                    ++ [ ForgetDeviceAutojoin channel ]
                )

            else
                ( { state | autojoinStatus = offlineStatus }, [] )

        RealnameEdit ->
            ( { state | realnameDraft = Just state.realname, realnameStatus = Nothing }, [ FocusId "um-selfname-input" ] )

        RealnameInput value ->
            ( { state | realnameDraft = Just (String.left maxRealnameLength value) }, [] )

        RealnameCancel ->
            ( { state | realnameDraft = Nothing, realnameStatus = Nothing }, [ FocusId "um-selfname-edit" ] )

        RealnameSave ->
            case cleanRealname (Maybe.withDefault state.realname state.realnameDraft) of
                Nothing ->
                    ( { state | realnameStatus = Just { text = "Use " ++ String.fromInt maxRealnameLength ++ " characters or fewer.", error = True } }, [] )

                Just "" ->
                    update ctx RealnameReset state

                Just clean ->
                    let
                        saved =
                            { state | realname = clean, realnameDraft = Nothing }
                    in
                    if ctx.live then
                        -- The echo needs the `setname` cap; the status
                        -- must not wait on it, so the change shows as
                        -- saved now and a 461 flips it to an error.
                        ( { saved
                            | realnameLive = Just clean
                            , realnameStatus = Just { text = "Saved. People see “" ++ clean ++ "” on your profile.", error = False }
                          }
                        , Persist :: sends [ setnameLine clean ] ++ [ FocusId "um-selfname-edit" ]
                        )

                    else
                        ( { saved | realnameStatus = Just { text = "Saved. It applies the next time you connect.", error = False } }, [ Persist, FocusId "um-selfname-edit" ] )

        RealnameReset ->
            let
                saved =
                    { state | realname = "", realnameDraft = Nothing }

                fallback =
                    ctx.nick ++ " (webchat)"
            in
            if ctx.live then
                ( { saved
                    | realnameLive = Just fallback
                    , realnameStatus = Just { text = "Back to the default name.", error = False }
                  }
                , Persist :: sends [ setnameLine fallback ] ++ [ FocusId "um-selfname-edit" ]
                )

            else
                ( { saved | realnameStatus = Just { text = "Back to the default name.", error = False } }, [ Persist, FocusId "um-selfname-edit" ] )

        ProfileLookup lookup ->
            profileLookup ctx lookup.nick lookup.account state

        OpenPrivacyPanel ->
            ( state, [ OpenPrivacy ] )


{-| Turn back on, once per connection, the modes this browser had on
(`wanted`) that the server's own report (`modes`) does not list.
-}
reassertModes : Ctx -> State -> ( State, List Effect )
reassertModes ctx state =
    if not state.modesKnown then
        ( state, [] )

    else
        let
            missing =
                state.wanted
                    |> Set.toList
                    |> List.filter (\l -> not (Set.member l state.modes) && modeAvailable state l)
        in
        case modeLine ctx.nick missing [] of
            Just line ->
                ( { state | pending = Dict.fromList (List.map (\l -> ( l, True )) missing) }
                , Send line :: sends [ modeQueryLine ctx.nick ]
                )

            Nothing ->
                ( state, [] )


heldStillPending : Float -> Held -> Bool
heldStillPending nowMs held =
    toFloat held.sendAt > nowMs - 60000


{-| "lounge" and "#lounge" both mean the room #lounge. -}
normalizeRoom : String -> Maybe String
normalizeRoom raw =
    let
        value =
            String.trim raw

        prefixed =
            if String.startsWith "#" value || String.startsWith "&" value then
                value

            else
                "#" ++ value
    in
    if String.isEmpty value || String.length prefixed < 2 then
        Nothing

    else
        wireToken prefixed


offlineStatus : Maybe Status
offlineStatus =
    Just { text = "Connect to change this.", error = True }


sends : List (Maybe String) -> List Effect
sends lines =
    List.filterMap (Maybe.map Send) lines


maybeToList : Maybe a -> List a
maybeToList m =
    case m of
        Just x ->
            [ x ]

        Nothing ->
            []


approve : String -> State -> ( State, List Effect )
approve nick state =
    let
        key =
            String.toLower nick

        listed =
            if List.any (\n -> String.toLower n == key) state.accepts then
                state.accepts

            else
                state.accepts ++ [ nick ]
    in
    ( { state
        | accepts = listed
        , requests = List.filter (\r -> String.toLower r.nick /= key) state.requests
        , acceptStatus = Just { text = nick ++ " can message you now.", error = False }
      }
    , sends [ acceptAddLine nick, Just acceptListLine ]
    )


toggleMode : Ctx -> Char -> State -> ( State, List Effect )
toggleMode ctx letter state =
    if not (isImplemented letter) then
        ( state, [] )

    else if not ctx.live then
        ( { state | modeStatus = offlineStatus }, [] )

    else
        let
            turnOn =
                not (modeOn state letter)

            line =
                if turnOn then
                    modeLine ctx.nick [ letter ] []

                else
                    modeLine ctx.nick [] [ letter ]

            wanted =
                if turnOn then
                    Set.insert letter state.wanted

                else
                    Set.remove letter state.wanted
        in
        case line of
            Nothing ->
                ( state, [] )

            Just l ->
                -- The 221 that follows the query settles `pending`
                -- even when the server applies nothing (no echo).
                ( { state
                    | pending = Dict.insert letter turnOn state.pending
                    , wanted = wanted
                    , modeStatus = Nothing
                  }
                , [ Send l, Persist ] ++ sends [ modeQueryLine ctx.nick ]
                )


profileLookup : Ctx -> String -> Maybe String -> State -> ( State, List Effect )
profileLookup ctx nick account state =
    if not ctx.live then
        ( state, [] )

    else
        let
            key =
                String.toLower nick

            ( afterWhowas, whowasOut ) =
                case ( state.whowasPending, Dict.member key state.whowas, whowasLine nick ) of
                    ( Nothing, False, Just line ) ->
                        ( { state | whowasPending = Just key, whowasBuffer = Nothing }, [ Send line ] )

                    _ ->
                        ( state, [] )
        in
        case account of
            Just acct ->
                let
                    ( afterSeen, seenOut ) =
                        askSeen acct afterWhowas
                in
                ( afterSeen, whowasOut ++ seenOut )

            Nothing ->
                ( afterWhowas, whowasOut )


askSeen : String -> State -> ( State, List Effect )
askSeen account state =
    let
        key =
            String.toLower account
    in
    if List.member key state.seenPending || Dict.member key state.seen then
        ( state, [] )

    else
        case seenLine account of
            Just line ->
                ( { state | seenPending = state.seenPending ++ [ key ] }, [ Send line ] )

            Nothing ->
                ( state, [] )



-- ── server-held schedule submit ───────────────────────────────────────


deferReplyWaitMs : Float
deferReplyWaitMs =
    15000


{-| Hand a send-later draft to the server (`DEFER AT`). Its reply is a bare
NOTICE with no id, so one request is in flight at a time and answers settle
in order; a request nobody answered stops blocking after a few seconds.
-}
deferSubmit : Ctx -> { channel : String, text : String, sendAt : Int } -> State -> Result String ( State, List Effect )
deferSubmit ctx input state =
    let
        body =
            String.trim input.text

        busy =
            not (List.isEmpty state.deferInflight) && ctx.nowMs - state.deferSentAt < deferReplyWaitMs

        holding =
            List.any
                (\h -> String.toLower h.channel == String.toLower input.channel && heldStillPending ctx.nowMs h)
                state.deferHeld
    in
    case ctx.account of
        Nothing ->
            Err "Sign in to have the server send messages for you."

        Just account ->
            if busy then
                Err "The server is still confirming the last one. Try again in a moment."

            else if toFloat input.sendAt <= ctx.nowMs then
                Err "Pick a time in the future."

            else if holding then
                Err ("The server already holds a message for " ++ input.channel ++ " (it keeps one per room). Choose “On this device” instead.")

            else
                case deferAtLine input.sendAt input.channel body of
                    Nothing ->
                        Err "The server can't hold that message. Keep it on this device instead."

                    Just line ->
                        Ok
                            ( { state
                                | deferInflight = [ { channel = input.channel, text = body, sendAt = input.sendAt, account = account } ]
                                , deferSentAt = ctx.nowMs
                              }
                            , [ Send line ]
                            )


{-| Held sends the server still owes (past ones have been sent). -}
heldPending : Float -> State -> List Held
heldPending nowMs state =
    List.filter (heldStillPending nowMs) state.deferHeld



-- ── local ignore ↔ server SILENCE ────────────────────────────────────


{-| `/ignore`, the block menu, undo: mirror a new local block to the
server when the person opted in (signed in, so it follows the account).
-}
ignoreAdded : Ctx -> String -> State -> ( State, List Effect )
ignoreAdded ctx nick state =
    if not state.serverIgnore || not ctx.live || ctx.account == Nothing then
        ( state, [] )

    else
        case maskForNick nick of
            Nothing ->
                ( state, [] )

            Just mask ->
                if List.any (\m -> String.toLower m == String.toLower mask) state.silenced then
                    ( state, [] )

                else if silenceFull ctx state then
                    ( { state
                        | silenceStatus =
                            Just
                                { text = "The server's block list is full (" ++ String.fromInt ctx.silenceLimit ++ "). " ++ nick ++ " is blocked on this device only."
                                , error = True
                                }
                      }
                    , []
                    )

                else
                    ( state, sends [ silenceAddLine mask ] )


{-| An unblock also lifts the server block it was mirrored to. -}
ignoreRemoved : Ctx -> String -> State -> ( State, List Effect )
ignoreRemoved ctx nick state =
    case maskForNick nick of
        Nothing ->
            ( state, [] )

        Just mask ->
            let
                listed =
                    List.any (\m -> String.toLower m == String.toLower mask) state.silenced
            in
            if ctx.live && (listed || (state.serverIgnore && not state.silenceKnown)) then
                ( state, sends [ silenceRemoveLine mask ] )

            else
                ( state, [] )


{-| Server blocks that are not "this person, any host" for a nick the
device list already names — the rest of the list a person manages here.
-}
serverOnlyBlocks : Set String -> State -> List String
serverOnlyBlocks ignored state =
    List.filter
        (\mask ->
            case silencedNick mask of
                Just nick ->
                    not (Set.member (String.toLower nick) ignored)

                Nothing ->
                    True
        )
        state.silenced


{-| Is this nick also blocked on the server? -}
silencedOnServer : State -> String -> Bool
silencedOnServer state nick =
    case maskForNick nick of
        Just mask ->
            List.any (\m -> String.toLower m == String.toLower mask) state.silenced

        Nothing ->
            False



-- ── offline profile ───────────────────────────────────────────────────


type alias Offline =
    { name : Maybe String
    , account : Maybe String
    , leftMs : Maybe Float
    , lastSeenMs : Maybe Float
    , loading : Bool
    , found : Bool
    }


{-| What WHOWAS/SEEN have said about an offline nick, or `Nothing`
before anyone asked. -}
offlineFor : String -> State -> Maybe Offline
offlineFor nick state =
    let
        key =
            String.toLower nick
    in
    case Dict.get key state.whowas of
        Nothing ->
            if state.whowasPending == Just key then
                Just { name = Nothing, account = Nothing, leftMs = Nothing, lastSeenMs = Nothing, loading = True, found = False }

            else
                Nothing

        Just w ->
            let
                accountKey =
                    Maybe.map String.toLower w.account

                seenRecord =
                    accountKey |> Maybe.andThen (\a -> Dict.get a state.seen)

                seenLoading =
                    case accountKey of
                        Just a ->
                            List.member a state.seenPending

                        Nothing ->
                            False
            in
            Just
                { name = w.realname
                , account = w.account
                , leftMs = Maybe.map (\secs -> toFloat secs * 1000) w.signoffSecs
                , lastSeenMs = seenRecord |> Maybe.andThen .lastSeenMs |> Maybe.map toFloat
                , loading = seenLoading
                , found = w.found || (seenRecord |> Maybe.map .found |> Maybe.withDefault False)
                }


{-| "Last seen 3 hours ago" for an offline profile, if anyone knows. -}
lastSeenLine : Float -> Offline -> Maybe String
lastSeenLine nowMs offline =
    case ( offline.lastSeenMs, offline.leftMs ) of
        ( Just seen, _ ) ->
            Just ("Last seen " ++ agoText nowMs seen)

        ( Nothing, Just left ) ->
            Just ("Last seen " ++ agoText nowMs left)

        ( Nothing, Nothing ) ->
            Nothing


{-| Relative age: "just now", "5 minutes ago", "3 hours ago", "2 days ago". -}
agoText : Float -> Float -> String
agoText nowMs thenMs =
    let
        secs =
            floor (max 0 (nowMs - thenMs) / 1000)

        unit n word =
            String.fromInt n ++ " " ++ word ++ (if n == 1 then "" else "s") ++ " ago"
    in
    if thenMs <= 0 then
        "a while ago"

    else if secs < 45 then
        "just now"

    else if secs < 3600 then
        unit (max 1 (secs // 60)) "minute"

    else if secs < 86400 then
        unit (secs // 3600) "hour"

    else if secs < 86400 * 14 then
        unit (secs // 86400) "day"

    else if secs < 86400 * 60 then
        unit (secs // (86400 * 7)) "week"

    else if secs < 86400 * 730 then
        unit (secs // (86400 * 30)) "month"

    else
        unit (secs // (86400 * 365)) "year"



-- ── inbound ───────────────────────────────────────────────────────────


type alias Folded =
    Maybe { state : State, effects : List Effect, consume : Bool }


{-| Fold one inbound line. `Nothing` = not ours (App folds it as
before). `consume = False` means App's own fold still runs (an
observer: 004, the own MODE echo, the SETNAME echo).
-}
foldWire : Ctx -> Wire.IrcMessage -> State -> Folded
foldWire ctx message state =
    let
        params =
            message.params

        at i =
            List.head (List.drop i params)

        str i =
            Maybe.withDefault "" (at i)

        trailing =
            Maybe.withDefault "" (List.head (List.reverse params))

        isMe nick =
            String.toLower nick == String.toLower ctx.nick

        fromServer =
            message.nick == Nothing || (message.prefix /= Nothing && message.prefix == ctx.serverPrefix)

        done s effects =
            Just { state = s, effects = effects, consume = True }

        observe s effects =
            Just { state = s, effects = effects, consume = False }
    in
    case message.command of
        "004" ->
            -- `004 <me> <server> <version> <usermodes> <chanmodes> …`
            case at 3 of
                Just letters ->
                    if String.isEmpty letters then
                        Nothing

                    else
                        observe { state | advertised = Just (Set.fromList (String.toList letters)) } []

                Nothing ->
                    Nothing

        "221" ->
            -- `221 <me> :+iR` (`handleUserMode` query form).
            let
                letters =
                    trailing |> String.toList |> List.filter Char.isAlpha |> Set.fromList

                settled =
                    { state | modes = letters, modesKnown = True, pending = Dict.empty }
            in
            if state.reassert then
                let
                    ( reasserted, effects ) =
                        reassertModes ctx { settled | reassert = False }
                in
                observe reasserted effects

            else
                observe settled []

        "MODE" ->
            -- `:me!u@h MODE me :+R-g` — the reflection of a self change.
            case params of
                target :: modeStr :: _ ->
                    if isMe target && not (ctx.isChannel target) then
                        observe (applyModeDelta modeStr state) []

                    else
                        Nothing

                _ ->
                    Nothing

        "281" ->
            -- `281 <me> <nick> :is on your accept list`
            case at 1 of
                Just nick ->
                    observe { state | acceptBuffer = state.acceptBuffer ++ [ nick ] } []

                Nothing ->
                    observe state []

        "282" ->
            observe { state | accepts = state.acceptBuffer, acceptBuffer = [], acceptLoading = False, acceptKnown = True } []

        "716" ->
            -- `716 <me> <target> :is in +g mode (must be accepted)`
            let
                target =
                    str 1

                key =
                    String.toLower target

                recent =
                    case Dict.get key state.notedAt of
                        Just t ->
                            ctx.nowMs - t < 60000

                        Nothing ->
                            False
            in
            if String.isEmpty target || recent then
                done state []

            else
                done { state | notedAt = Dict.insert key ctx.nowMs state.notedAt }
                    [ DmNote
                        { peer = target
                        , text = target ++ " approves new conversations first. Onyx let them know you'd like to talk. Once they accept, send your message again."
                        }
                    ]

        "717" ->
            -- `717 <me> <target> :has been informed that you messaged them`
            -- (folded into the 716 note).
            done state []

        "718" ->
            -- `718 <me> <sender> <user@host> :is messaging you, and you have umode +g set…`
            let
                sender =
                    str 1

                key =
                    String.toLower sender

                known =
                    List.any (\r -> String.toLower r.nick == key) state.requests
            in
            if wireToken sender == Nothing || Set.member key ctx.ignored then
                done state []

            else if known then
                done
                    { state
                        | requests =
                            List.map
                                (\r ->
                                    if String.toLower r.nick == key then
                                        { r | atMs = ctx.nowMs }

                                    else
                                        r
                                )
                                state.requests
                    }
                    []

            else
                done
                    { state
                        | requests = List.take 20 ({ nick = sender, atMs = ctx.nowMs } :: state.requests)
                        , requestsUnseen = state.requestsUnseen + 1
                    }
                    [ Toast { title = sender ++ " wants to message you", body = "Open your Inbox to approve or ignore the request.", error = False } ]

        "477" ->
            -- `477 <me> <nick> :Cannot message this user (+R: …)` — only the DM form.
            let
                target =
                    str 1
            in
            if String.isEmpty target || ctx.isChannel target then
                Nothing

            else
                -- Observed, not consumed: the server's own words still reach
                -- the inbox (v3/gap-shell); this adds the plain sentence in
                -- the conversation that was refused.
                observe state
                    [ DmNote
                        { peer = target
                        , text = target ++ " only accepts messages from people signed in to an Onyx account. Keep your name with an account to message them."
                        }
                    ]

        "SILENCE" ->
            -- `:me!u@h SILENCE +mask` per applied change (`handleSilence`).
            case ( message.nick, params ) of
                ( Just nick, op :: _ ) ->
                    if isMe nick then
                        done (applySilence op state) []

                    else
                        Nothing

                _ ->
                    Nothing

        "271" ->
            -- `271 <me> <mask,mask,…> :` — one comma-joined line.
            let
                masks =
                    str 1 |> String.split "," |> List.map String.trim |> List.filter (not << String.isEmpty)
            in
            observe { state | silenceBuffer = state.silenceBuffer ++ masks } []

        "272" ->
            observe { state | silenced = state.silenceBuffer, silenceBuffer = [], silenceLoading = False, silenceKnown = True } []

        "314" ->
            -- `314 <me> <nick> <user> <host> * :<realname>`
            whowasRow str (\w -> { w | realname = nonEmpty trailing }) state

        "330" ->
            -- WHOWAS reuses `330 <me> <nick> <account> :is logged in as`.
            case state.whowasBuffer of
                Just _ ->
                    whowasRow str (\w -> { w | account = nonEmpty (str 2) }) state

                Nothing ->
                    Nothing

        "312" ->
            -- WHOWAS reuses `312 <me> <nick> <server> :<signoff unix secs>`.
            case state.whowasBuffer of
                Just _ ->
                    whowasRow str (\w -> { w | signoffSecs = String.toInt (String.trim trailing) }) state

                Nothing ->
                    Nothing

        "401" ->
            -- `401 <me> <nick> :No such nick` for a profile that is open:
            -- the person is offline, so ask for their last identity.
            if Set.member (String.toLower (str 1)) ctx.profileNicks then
                let
                    ( asked, effects ) =
                        profileLookup ctx (str 1) Nothing state
                in
                observe asked effects

            else
                Nothing

        "406" ->
            -- `406 <me> <nick> :There was no such nickname`
            if Just (String.toLower (str 1)) == state.whowasPending then
                done { state | whowasBuffer = Nothing } []

            else
                Nothing

        "369" ->
            -- `369 <me> <nick> :End of WHOWAS`
            let
                nick =
                    str 1

                key =
                    String.toLower nick
            in
            if Just key /= state.whowasPending then
                Nothing

            else
                let
                    record =
                        Maybe.withDefault { nick = nick, realname = Nothing, account = Nothing, signoffSecs = Nothing, found = False } state.whowasBuffer

                    stored =
                        { state | whowas = Dict.insert key record state.whowas, whowasPending = Nothing, whowasBuffer = Nothing }
                in
                case record.account of
                    Just account ->
                        let
                            ( asked, out ) =
                                askSeen account stored
                        in
                        done asked out

                    Nothing ->
                        done stored []

        "SETNAME" ->
            case ( message.nick, params ) of
                ( Just nick, name :: _ ) ->
                    if isMe nick then
                        observe { state | realnameLive = Just name } []

                    else
                        Nothing

                _ ->
                    Nothing

        "461" ->
            -- `461 <me> <COMMAND> :<usage>`
            needMore (String.toUpper (str 1)) trailing state

        "403" ->
            deferNumeric (str 1) "That room no longer exists." state

        "442" ->
            deferNumeric (str 1) "You need to be in the room to schedule there." state

        "FAIL" ->
            failReply (str 0) (str 1) trailing state

        "NOTICE" ->
            if fromServer && (isMe (str 0) || str 0 == "*") then
                serverNotice ctx trailing state

            else
                Nothing

        _ ->
            Nothing


nonEmpty : String -> Maybe String
nonEmpty value =
    if String.isEmpty (String.trim value) then
        Nothing

    else
        Just (String.trim value)


applyModeDelta : String -> State -> State
applyModeDelta modeStr state =
    let
        step c ( adding, s ) =
            if c == '+' then
                ( True, s )

            else if c == '-' then
                ( False, s )

            else
                ( adding
                , { s
                    | modes =
                        if adding then
                            Set.insert c s.modes

                        else
                            Set.remove c s.modes
                    , pending = Dict.remove c s.pending
                  }
                )
    in
    Tuple.second (List.foldl step ( True, state ) (String.toList modeStr))


applySilence : String -> State -> State
applySilence op state =
    case String.uncons op of
        Just ( '+', mask ) ->
            if List.any (\m -> String.toLower m == String.toLower mask) state.silenced then
                state

            else
                { state | silenced = state.silenced ++ [ mask ] }

        Just ( '-', mask ) ->
            { state | silenced = List.filter (\m -> String.toLower m /= String.toLower mask) state.silenced }

        _ ->
            state


whowasRow : (Int -> String) -> (Whowas -> Whowas) -> State -> Folded
whowasRow str patch state =
    let
        nick =
            str 1

        key =
            String.toLower nick
    in
    if Just key /= state.whowasPending then
        Nothing

    else
        let
            base =
                Maybe.withDefault { nick = nick, realname = Nothing, account = Nothing, signoffSecs = Nothing, found = True } state.whowasBuffer

            -- Only the newest record fills a field (`WHOWAS <nick> 1`
            -- asks for one; a server that sends more never overwrites).
            next =
                patch base

            merged =
                { base
                    | realname = orElse base.realname next.realname
                    , account = orElse base.account next.account
                    , signoffSecs = orElse base.signoffSecs next.signoffSecs
                    , found = True
                }
        in
        Just { state = { state | whowasBuffer = Just merged }, effects = [], consume = True }


orElse : Maybe a -> Maybe a -> Maybe a
orElse first second =
    case first of
        Just _ ->
            first

        Nothing ->
            second


needMore : String -> String -> State -> Folded
needMore command usage state =
    let
        done s =
            Just { state = s, effects = [], consume = True }
    in
    case command of
        "MEMO" ->
            done { state | memoSending = False, memoStatus = Just { text = "The server needs more detail: " ++ usage, error = True } }

        "ACCEPT" ->
            done { state | acceptLoading = False, acceptStatus = Just { text = "That name can't be approved.", error = True } }

        "SILENCE" ->
            done { state | silenceLoading = False, silenceStatus = Just { text = "The server couldn't read that block.", error = True } }

        "SETNAME" ->
            done { state | realnameStatus = Just { text = "That name is too long for the server.", error = True } }

        "DEFER" ->
            case state.deferInflight of
                held :: rest ->
                    Just
                        { state = { state | deferInflight = rest }
                        , effects = [ DeferSettled { ok = False, held = held, error = "The server couldn't schedule that message. Keep it on this device instead." } ]
                        , consume = True
                        }

                [] ->
                    Nothing

        "WHOWAS" ->
            done { state | whowasPending = Nothing, whowasBuffer = Nothing }

        "SEEN" ->
            done { state | seenPending = List.drop 1 state.seenPending }

        _ ->
            Nothing


deferNumeric : String -> String -> State -> Folded
deferNumeric channel text state =
    case state.deferInflight of
        held :: rest ->
            if String.toLower held.channel == String.toLower channel then
                Just
                    { state = { state | deferInflight = rest }
                    , effects = [ DeferSettled { ok = False, held = held, error = text } ]
                    , consume = True
                    }

            else
                Nothing

        [] ->
            Nothing


failReply : String -> String -> String -> State -> Folded
failReply command code description state =
    case String.toUpper command of
        "MEMO" ->
            let
                text =
                    case code of
                        "ACCOUNT_UNKNOWN" ->
                            "There's no Onyx account with that name."

                        "ACCOUNT_REQUIRED" ->
                            "Sign in to use offline messages."

                        "FORWARD_CYCLE" ->
                            "That would forward messages in a circle. Pick a different account."

                        "MAILBOX_FULL" ->
                            "Their mailbox is full right now. Try again later."

                        "INVALID_MESSAGE" ->
                            "That message can't be stored. Keep it to one line of plain text."

                        "INVALID_ACCOUNT" ->
                            "That account name isn't valid."

                        "TEMPORARILY_UNAVAILABLE" ->
                            "Offline messages are unavailable right now. Try again soon."

                        _ ->
                            if String.isEmpty description then
                                "The server refused that (" ++ code ++ ")."

                            else
                                description
            in
            Just
                { state = { state | memoSending = False, memoListing = False, memoIgnoreListing = False, memoStatus = Just { text = text, error = True } }
                , effects = []
                , consume = True
                }

        "AUTOJOIN" ->
            let
                text =
                    if code == "ACCOUNT_REQUIRED" then
                        "Sign in to keep rooms on your account."

                    else if String.isEmpty description then
                        "The server refused that (" ++ code ++ ")."

                    else
                        description
            in
            Just
                { state = { state | autojoinListing = False, autojoinStatus = Just { text = text, error = True } }
                , effects = []
                , consume = True
                }

        _ ->
            Nothing


{-| Server NOTICEs from `handleMemo`, `handleDefer`, `handleAutojoin`
and `handleSeen` (all `noticeTo`: `:<server> NOTICE <me> :<text>`).
-}
serverNotice : Ctx -> String -> State -> Folded
serverNotice ctx text state =
    let
        done s effects =
            Just { state = s, effects = effects, consume = True }

        -- Any other server line ends a SEEN detail run.
        s0 =
            if state.seenDetail then
                { state | seenDetail = False }

            else
                state
    in
    if state.seenDetail && String.startsWith "  " text then
        -- `  login <ms> <hostmask>` detail rows: hostmasks are never shown.
        done state []

    else if String.startsWith "MEMO from " text then
        case parseMemoNotice text of
            Just ( from, body ) ->
                let
                    memo =
                        { from = from, text = body, atMs = ctx.nowMs }
                in
                if s0.memoListing then
                    done { s0 | memoBuffer = s0.memoBuffer ++ [ memo ] } []

                else
                    done { s0 | memoDelivered = List.take 50 (s0.memoDelivered ++ [ memo ]) } [ DeliverMemo { from = from, text = body } ]

            Nothing ->
                Nothing

    else if String.startsWith "MEMO:" text then
        done (memoNotice (String.trim (String.dropLeft 5 text)) s0) []

    else if String.startsWith "DEFER:" text then
        deferNotice (String.trim (String.dropLeft 6 text)) s0

    else if text == "AUTOJOIN added" then
        done { s0 | autojoinStatus = Just { text = "Added to your account.", error = False } } []

    else if text == "AUTOJOIN removed" then
        done { s0 | autojoinStatus = Just { text = "Removed from your account.", error = False } } []

    else if String.startsWith "AUTOJOIN:" text then
        let
            rest =
                String.trim (String.dropLeft 9 text)
        in
        if rest == "end of list" then
            done { s0 | autojoins = s0.autojoinBuffer, autojoinBuffer = [], autojoinListing = False, autojoinKnown = True } []

        else if String.startsWith "could not add" rest then
            done { s0 | autojoinStatus = Just { text = "The server couldn't add that room (it may already be listed, or the list is full).", error = True } } []

        else
            done s0 []

    else if String.startsWith "AUTOJOIN " text then
        let
            channel =
                String.trim (String.dropLeft 9 text)
        in
        if ctx.isChannel channel then
            if s0.autojoinListing then
                done { s0 | autojoinBuffer = s0.autojoinBuffer ++ [ channel ] } []

            else
                done s0 []

        else
            Nothing

    else if String.startsWith "Usage: AUTOJOIN" text then
        done { s0 | autojoinListing = False } []

    else if String.startsWith "SEEN " text then
        seenNotice (String.dropLeft 5 text) s0

    else
        Nothing


{-| `MEMO from <from> :<text>` → (from, text). -}
parseMemoNotice : String -> Maybe ( String, String )
parseMemoNotice text =
    if not (String.startsWith "MEMO from " text) then
        Nothing

    else
        let
            rest =
                String.dropLeft 10 text
        in
        case String.indexes " " rest of
            i :: _ ->
                let
                    from =
                        String.left i rest

                    after =
                        String.dropLeft (i + 1) rest

                    body =
                        if String.startsWith ":" after then
                            String.dropLeft 1 after

                        else
                            after
                in
                if wireToken from == Nothing then
                    Nothing

                else
                    Just ( from, body )

            [] ->
                Nothing


memoNotice : String -> State -> State
memoNotice rest state =
    let
        ok text =
            Just { text = text, error = False }

        after prefix =
            String.trim (String.dropLeft (String.length prefix) rest)
    in
    if String.startsWith "End of offline memos" rest then
        { state | memoWaiting = state.memoBuffer, memoBuffer = [], memoListing = False, memoKnown = True }

    else if String.startsWith "Cleared " rest then
        { state | memoWaiting = [], memoStatus = ok "Cleared your waiting messages." }

    else if String.startsWith "Forwarding your offline memos to " rest then
        { state | memoForward = nonEmpty (after "Forwarding your offline memos to "), memoForwardKnown = True }

    else if rest == "No forward set" then
        { state | memoForward = Nothing, memoForwardKnown = True }

    else if rest == "forwarding disabled" then
        { state | memoForward = Nothing, memoForwardKnown = True, memoStatus = ok "Forwarding is off." }

    else if String.startsWith "ignoring " rest then
        { state | memoIgnoreBuffer = state.memoIgnoreBuffer ++ [ after "ignoring " ] }

    else if String.startsWith "End of ignore list" rest then
        { state | memoIgnores = state.memoIgnoreBuffer, memoIgnoreBuffer = [], memoIgnoreListing = False }

    else if String.startsWith "now ignoring memos from " rest then
        { state | memoStatus = ok ("Messages from " ++ after "now ignoring memos from " ++ " will be dropped.") }

    else if String.startsWith "no longer ignoring " rest then
        { state | memoStatus = ok (after "no longer ignoring " ++ " can leave you messages again.") }

    else if String.startsWith "message stored" rest then
        let
            forwarded =
                case String.split "forwarded to " rest of
                    _ :: target :: _ ->
                        " It was forwarded to " ++ String.trim (String.replace ")" "" target) ++ "."

                    _ ->
                        ""

            who =
                if String.isEmpty (String.trim state.memoTo) then
                    "They"

                else
                    String.trim state.memoTo
        in
        { state
            | memoSending = False
            , memoText = ""
            , memoStatus = ok ("Saved. " ++ who ++ " gets it the next time they sign in." ++ forwarded)
        }

    else
        state


deferNotice : String -> State -> Folded
deferNotice rest state =
    case state.deferInflight of
        [] ->
            Just { state = state, effects = [], consume = True }

        held :: remaining ->
            let
                fail error =
                    Just { state = { state | deferInflight = remaining }, effects = [ DeferSettled { ok = False, held = held, error = error } ], consume = True }
            in
            if rest == "scheduled" then
                Just
                    { state = { state | deferInflight = remaining, deferHeld = List.take maxHeld (state.deferHeld ++ [ held ]) }
                    , effects = [ DeferSettled { ok = True, held = held, error = "" }, Persist ]
                    , consume = True
                    }

            else if rest == "already scheduled" then
                fail ("The server already holds a message for " ++ held.channel ++ " — it keeps one per room. Choose “On this device” to schedule this one.")

            else if rest == "message is too long" then
                fail "Too long for the server to hold (400 bytes). Choose “On this device” instead."

            else if String.startsWith "could not schedule" rest then
                fail "The server's schedule is full right now. Choose “On this device” instead."

            else if String.startsWith "could not store" rest then
                fail "The server couldn't store it. Try again, or keep it on this device."

            else
                fail "The server couldn't read that time. Pick another time."


seenNotice : String -> State -> Folded
seenNotice rest state =
    case String.indexes ": " rest of
        i :: _ ->
            let
                account =
                    String.left i rest

                key =
                    String.toLower account

                body =
                    String.dropLeft (i + 2) rest

                fieldMs name =
                    body
                        |> String.words
                        |> List.filterMap
                            (\w ->
                                if String.startsWith (name ++ "=") w then
                                    String.toInt (String.dropLeft (String.length name + 1) w)

                                else
                                    Nothing
                            )
                        |> List.head
                        |> Maybe.andThen
                            (\n ->
                                if n > 0 then
                                    Just n

                                else
                                    Nothing
                            )

                record =
                    if body == "no record" then
                        { account = account, lastSeenMs = Nothing, lastLoginMs = Nothing, found = False }

                    else
                        { account = account, lastSeenMs = fieldMs "last_seen", lastLoginMs = fieldMs "last_login", found = True }
            in
            if wireToken account == Nothing then
                Nothing

            else
                Just
                    { state =
                        { state
                            | seen = Dict.insert key record state.seen
                            , seenPending = List.filter (\p -> p /= key) state.seenPending
                            , seenDetail = record.found
                        }
                    , effects = []
                    , consume = True
                    }

        [] ->
            Nothing
