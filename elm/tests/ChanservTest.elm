module ChanservTest exposing (suite)

{-| v3/gap-chanserv — wire-line vectors and behaviour for registered-room
services (`CHANNEL`/`CS`, `SUCCESSOR`, `LISTCHANS`), join refusals
(489/520/470/477/480), KNOCK, the +Z/+e/+I lists, `TEMPMODE`, the
welcome message and slow mode.

Pure core (`Chanserv`) runs directly; behaviour that crosses App runs
through `App.update` so the settle step is covered too. Every reply
shape here is the one `handleChannel` (server.zig) and friends emit.
-}

import App exposing (..)
import Chanserv exposing (Effect(..), Msg(..), Registration(..), Tone(..))
import Dict exposing (Dict)
import Expect
import Html
import Html.Attributes as Attr
import Modes
import Set
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import RoomSettings
import View
import View.Chanserv
import Wire


wire : String -> String
wire raw =
    raw ++ "\u{000D}\n"


ctx : Chanserv.Ctx
ctx =
    { room = Just "#c"
    , live = True
    , isOp = True
    , isOper = False
    , account = Just "kai"
    , props = Dict.empty
    , modes = "+nt"
    , nowMs = 1000000
    }


foldCtx : Chanserv.FoldCtx
foldCtx =
    { ourNick = "me"
    , nowMs = 1000000
    , isChannel = String.startsWith "#"
    , inChannel = \c -> String.toLower c == "#c"
    , groups = Modes.defaultChanGroups
    , prefixModes = Set.fromList [ 'Y', 'Q', 'q', 'o', 'v' ]
    }


sends : List Effect -> List String
sends =
    List.filterMap
        (\e ->
            case e of
                Send line ->
                    Just line

                _ ->
                    Nothing
        )


upd : Chanserv.Ctx -> Msg -> Chanserv.State -> ( Chanserv.State, List Effect )
upd =
    Chanserv.update


fld : String -> Chanserv.State -> ( Chanserv.State, List Effect )
fld raw =
    Chanserv.fold foldCtx (Wire.parseIrcMessage raw)


foldAll : List String -> Chanserv.State -> Chanserv.State
foldAll raws state =
    List.foldl (\l s -> Tuple.first (fld l s)) state raws


{-| The state after answering `CHANNEL INFO` for a registered room. -}
registeredBy : String -> Chanserv.State
registeredBy founder =
    foldAll [ ":srv.test NOTICE me :channel=#c founder=" ++ founder ++ " flags=3 mlock=+nt topiclock=true guard=false private=false" ] Chanserv.blank


mine : Chanserv.State
mine =
    registeredBy "kai"


sendsOf : Msg -> Chanserv.State -> List String
sendsOf msg state =
    upd ctx msg state |> Tuple.second |> sends


withDraft : (Chanserv.Drafts -> Chanserv.Drafts) -> Chanserv.State -> Chanserv.State
withDraft f state =
    { state | drafts = f state.drafts }


{-| App with our own room open, op, live. -}
room : { op : Bool, props : List ( String, String ), modes : String } -> Model
room o =
    { blank
        | ourNick = "me"
        , connection = Live
        , activeChannel = Just "#c"
        , accountName = Just "kai"
        , channels =
            Dict.singleton "#c"
                { name = "#c"
                , topic = ""
                , members =
                    Dict.fromList
                        [ ( "me"
                          , { nick = "me"
                            , modes =
                                if o.op then
                                    Set.singleton 'o'

                                else
                                    Set.empty
                            , away = False
                            }
                          )
                        , ( "ann", { nick = "ann", modes = Set.empty, away = False } )
                        ]
                , modes = o.modes
                , messages = []
                , lastSeen = Nothing
                , unread = 0
                , highlights = 0
                , createdAt = Nothing
                }
        }
        |> withProps o.props


withProps : List ( String, String ) -> App.Model -> App.Model
withProps pairs model =
    let
        props =
            model.props
    in
    { model | props = { props | channelProps = Dict.insert "#c" (Dict.fromList pairs) props.channelProps } }


feed : Model -> String -> ( Model, List Outbound )
feed model line =
    update (WsLineReceived line) model


feedAll : List String -> Model -> Model
feedAll raws model =
    List.foldl (\l m -> Tuple.first (feed m l)) model raws


lines : List Outbound -> List String
lines outs =
    List.filterMap
        (\o ->
            case o of
                SendLine l ->
                    Just l

                _ ->
                    Nothing
        )
        outs


suite : Test
suite =
    describe "v3/gap-chanserv"
        [ builders
        , updateWire
        , foldReplies
        , deleteRoom
        , joinRefusals
        , knockTests
        , maskLists
        , slowMode
        , welcome
        , views
        ]


builders : Test
builders =
    describe "builders and copy"
        [ test "INFO line" <|
            \_ -> Expect.equal (wire "CHANNEL INFO #c") (Chanserv.infoLine "#c")
        , test "KNOCK line carries a trimmed note; control bytes become spaces" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (wire "KNOCK #c") (Chanserv.knockLine "#c" "   ")
                    , \_ -> Expect.equal (wire "KNOCK #c :let me in") (Chanserv.knockLine "#c" "  let me in ")
                    , \_ -> Expect.equal (wire "KNOCK #c :a b") (Chanserv.knockLine "#c" "a\u{0001}b")
                    ]
                    ()
        , test "mask list query is MODE +letter" <|
            \_ -> Expect.equal (wire "MODE #c +Z") (Chanserv.modeListLine "#c" 'Z')
        , test "MLOCK spec round trips and is empty only when nothing is locked" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "+nt-k") (Chanserv.buildMlock (Chanserv.parseMlock "+nt-k"))
                    , \_ -> Expect.equal Nothing (Chanserv.buildMlock Dict.empty)
                    , \_ -> Expect.equal (Just "-i") (Chanserv.buildMlock (Dict.fromList [ ( 'i', "off" ) ]))
                    , \_ -> Expect.equal (Dict.fromList [ ( 'n', "on" ), ( 't', "on" ), ( 'k', "off" ) ]) (Chanserv.parseMlock "+nt-k")
                    ]
                    ()
        , test "INFO parses founder, mlock and flags" <|
            \_ ->
                case Chanserv.parseInfo "channel=#c founder=kai flags=3 mlock=+nt topiclock=true guard=false private=true" of
                    Just ( channel, info ) ->
                        Expect.all
                            [ \_ -> Expect.equal "#c" channel
                            , \_ -> Expect.equal "kai" info.founder
                            , \_ -> Expect.equal "+nt" info.mlock
                            , \_ -> Expect.equal True info.topiclock
                            , \_ -> Expect.equal False info.guard
                            , \_ -> Expect.equal True info.private
                            ]
                            ()

                    Nothing ->
                        Expect.fail "did not parse"
        , test "INFO refuses lines without a channel and a founder" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (Chanserv.parseInfo "channel=#c")
                    , \_ -> Expect.equal Nothing (Chanserv.parseInfo "channel=nochan founder=kai")
                    , \_ -> Expect.equal Nothing (Chanserv.parseInfo "hello world")
                    ]
                    ()
        , test "FAIL CHANNEL codes read as plain sentences, never raw codes" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "Only the room's founder can do that." (Chanserv.failCopy "SET" "ACCESS_DENIED" "")
                    , \_ -> Expect.equal "Sign in to your Onyx account first." (Chanserv.failCopy "REGISTER" "ACCOUNT_REQUIRED" "")
                    , \_ -> Expect.equal "This room is already registered." (Chanserv.failCopy "REGISTER" "CHANNEL_EXISTS" "")
                    , \_ -> Expect.equal "This room isn't registered." (Chanserv.failCopy "INFO" "CHANNEL_UNKNOWN" "")
                    , \_ -> Expect.equal "That mask is already on the auto-kick list." (Chanserv.failCopy "AKICK" "AKICK_EXISTS" "")
                    , \_ -> Expect.equal "There's no Onyx account with that name." (Chanserv.failCopy "SUCCESSOR" "ACCOUNT_UNKNOWN" "")
                    , \_ -> Expect.equal "The server refused that (WEIRD)." (Chanserv.failCopy "SET" "WEIRD" "")
                    , \_ -> Expect.equal "Server words" (Chanserv.failCopy "SET" "WEIRD" "Server words")
                    ]
                    ()
        , test "join refusal copy names the reason in words, never a mode letter" <|
            \_ ->
                let
                    copy code text =
                        Chanserv.joinRefusalCopy code "#c" text
                in
                Expect.all
                    [ \_ -> Expect.equal ( "#c needs a secure connection", "This room only accepts encrypted (TLS) connections, and this connection doesn't qualify." ) (copy "489" "")
                    , \_ -> Expect.equal ( "#c is for network operators", "Only Onyx network operators can join." ) (copy "520" "Cannot join channel (+O) - IRC operator required")
                    , \_ -> Expect.equal ( "#c is for network administrators", "Only Onyx network administrators can join." ) (copy "520" "Cannot join channel (+A) - server administrator required")
                    , \_ -> Expect.equal ( "#c is for signed-in accounts", "Sign in to your Onyx account to join." ) (copy "477" "")
                    , \_ -> Expect.equal ( "#c is busy", "Too many people are joining right now. Try again in a moment." ) (copy "480" "")
                    , \_ -> Expect.equal ( "#c is invite-only", "A host has to invite you." ) (copy "473" "")
                    , \_ -> Expect.equal ( "#c needs a key", "Enter the room key, or ask the hosts to let you in." ) (copy "475" "")
                    , \_ -> Expect.equal ( "#c is full", "It has reached its member limit." ) (copy "471" "")
                    ]
                    ()
        , test "slow mode gap reads like the server: whole seconds in 1..86400, else off" <|
            \_ ->
                let
                    gap v =
                        Chanserv.slowGapOf (Dict.fromList [ ( "SLOWMODE", v ) ])
                in
                Expect.all
                    [ \_ -> Expect.equal 30 (gap "30")
                    , \_ -> Expect.equal 30 (gap " 30 ")
                    , \_ -> Expect.equal 0 (gap "0")
                    , \_ -> Expect.equal 0 (gap "-5")
                    , \_ -> Expect.equal 0 (gap "86401")
                    , \_ -> Expect.equal 86400 (gap "86400")
                    , \_ -> Expect.equal 0 (gap "soon")
                    , \_ -> Expect.equal 0 (Chanserv.slowGapOf Dict.empty)
                    , \_ -> Expect.equal 12 (Chanserv.slowGapOf (Dict.fromList [ ( "slowmode", "12" ) ]))
                    ]
                    ()
        , test "slow mode exemptions: opers always, voice and up unless SLOWVOICE is 0" <|
            \_ ->
                let
                    exempt props modes oper =
                        Chanserv.slowExempt { props = props, selfModes = modes, isOper = oper }
                in
                Expect.all
                    [ \_ -> Expect.equal False (exempt Dict.empty [] False)
                    , \_ -> Expect.equal True (exempt Dict.empty [ 'v' ] False)
                    , \_ -> Expect.equal True (exempt Dict.empty [ 'o' ] False)
                    , \_ -> Expect.equal False (exempt (Dict.fromList [ ( "SLOWVOICE", "0" ) ]) [ 'o' ] False)
                    , \_ -> Expect.equal True (exempt (Dict.fromList [ ( "SLOWVOICE", "1" ) ]) [ 'v' ] False)
                    , \_ -> Expect.equal True (exempt (Dict.fromList [ ( "SLOWVOICE", "0" ) ]) [] True)
                    ]
                    ()
        , test "slow mode wait counts down from the last send and clears after the gap" <|
            \_ ->
                let
                    state =
                        { mine | slowSent = Dict.fromList [ ( "#c", 100000 ) ] }

                    wait now =
                        Chanserv.slowWait { props = Dict.fromList [ ( "SLOWMODE", "30" ) ], selfModes = [], isOper = False, nowMs = now } "#C" state
                in
                Expect.all
                    [ \_ -> Expect.equal 30000 (wait 100000)
                    , \_ -> Expect.equal 10000 (wait 120000)
                    , \_ -> Expect.equal 0 (wait 130000)
                    , \_ -> Expect.equal 0 (wait 999999)
                    ]
                    ()
        , test "seconds read as words" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "Off" (Chanserv.formatSeconds 0)
                    , \_ -> Expect.equal "30 seconds" (Chanserv.formatSeconds 30)
                    , \_ -> Expect.equal "1 minute" (Chanserv.formatSeconds 60)
                    , \_ -> Expect.equal "7 minutes" (Chanserv.formatSeconds 420)
                    , \_ -> Expect.equal "2 hours" (Chanserv.formatSeconds 7200)
                    , \_ -> Expect.equal "1 second" (Chanserv.formatSeconds 1)
                    ]
                    ()
        , test "validation: channels, tokens, masks" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (Chanserv.validChannel "#room")
                    , \_ -> Expect.equal False (Chanserv.validChannel "#")
                    , \_ -> Expect.equal False (Chanserv.validChannel "room")
                    , \_ -> Expect.equal False (Chanserv.validChannel "#a b")
                    , \_ -> Expect.equal False (Chanserv.validChannel "#a,b")
                    , \_ -> Expect.equal True (Chanserv.validToken 8 "kai")
                    , \_ -> Expect.equal False (Chanserv.validToken 8 "")
                    , \_ -> Expect.equal False (Chanserv.validToken 2 "kai")
                    , \_ -> Expect.equal False (Chanserv.validToken 8 ":kai")
                    , \_ -> Expect.equal False (Chanserv.validToken 8 "a b")
                    , \_ -> Expect.equal True (Chanserv.validMask "a!*@*")
                    ]
                    ()
        ]


updateWire : Test
updateWire =
    describe "UI messages put the exact lines the server parses"
        [ test "Register" <|
            \_ -> Expect.equal [ wire "CHANNEL REGISTER #c" ] (sendsOf Register Chanserv.blank)
        , test "Register needs op, an account and a live socket" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (upd { ctx | isOp = False } Register Chanserv.blank |> Tuple.second |> sends)
                    , \_ -> Expect.equal [] (upd { ctx | account = Nothing } Register Chanserv.blank |> Tuple.second |> sends)
                    , \_ -> Expect.equal [] (upd { ctx | live = False } Register Chanserv.blank |> Tuple.second |> sends)
                    ]
                    ()
        , test "description and website save as one parameter each" <|
            \_ ->
                let
                    withText =
                        mine |> withDraft (\d -> { d | desc = "  A calm room  ", url = "https://x.example" })
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL SET #c DESC :A calm room" ] (sendsOf DescSave withText)
                    , \_ -> Expect.equal [ wire "CHANNEL SET #c URL https://x.example" ] (sendsOf UrlSave withText)
                    ]
                    ()
        , test "an empty description is not sent (the server parser refuses empty values)" <|
            \_ -> Expect.equal [] (sendsOf DescSave (mine |> withDraft (\d -> { d | desc = "   " })))
        , test "a website with a space is refused locally" <|
            \_ -> Expect.equal [] (sendsOf UrlSave (mine |> withDraft (\d -> { d | url = "not a url" })))
        , test "locked rules send one +on-off spec; nothing locked says so" <|
            \_ ->
                let
                    picks =
                        mine
                            |> Chanserv.update ctx (MlockPick 'n' "on")
                            |> Tuple.first
                            |> Chanserv.update ctx (MlockPick 'i' "off")
                            |> Tuple.first
                            |> Chanserv.update ctx (MlockPick 't' "on")
                            |> Tuple.first

                    cleared =
                        mine |> withDraft (\d -> { d | mlock = Dict.empty })
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL SET #c MLOCK +nt-i" ] (sendsOf MlockSave picks)
                    , \_ -> Expect.equal [] (sendsOf MlockSave cleared)
                    , \_ ->
                        Expect.equal (Just "Lock at least one rule. Onyx Server can't clear every lock at once.")
                            (Chanserv.statusOf "#c" "reg" (Tuple.first (upd ctx MlockSave cleared)) |> Maybe.map .text)
                    ]
                    ()
        , test "keep-topic and the three flags use on/off words" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL SET #c KEEPTOPIC on" ] (sendsOf (KeepTopicSet True) mine)
                    , \_ -> Expect.equal [ wire "CHANNEL SET #c KEEPTOPIC off" ] (sendsOf (KeepTopicSet False) mine)
                    , \_ -> Expect.equal [ wire "CHANNEL SET #c GUARD on" ] (sendsOf (FlagSet "GUARD" True) mine)
                    , \_ -> Expect.equal [ wire "CHANNEL SET #c TOPICLOCK off" ] (sendsOf (FlagSet "TOPICLOCK" False) mine)
                    , \_ -> Expect.equal [ wire "CHANNEL SET #c PRIVATE on" ] (sendsOf (FlagSet "PRIVATE" True) mine)
                    , \_ -> Expect.equal [] (sendsOf (FlagSet "FOUNDER" True) mine)
                    ]
                    ()
        , test "registration settings are founder-only, with a plain refusal" <|
            \_ ->
                let
                    other =
                        registeredBy "someone-else"

                    ( state, effects ) =
                        upd ctx (FlagSet "GUARD" True) other
                in
                Expect.all
                    [ \_ -> Expect.equal [] (sends effects)
                    , \_ -> Expect.equal (Just "Only the room's founder can change this.") (Chanserv.statusOf "#c" "reg" state |> Maybe.map .text)
                    ]
                    ()
        , test "account access: add, remove, list" <|
            \_ ->
                let
                    withAccount =
                        mine |> withDraft (\d -> { d | accessAccount = " mara ", accessLevel = "VOICE" })
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL ACCESS #c LIST" ] (sendsOf AccessLoad mine)
                    , \_ -> Expect.equal [ wire "CHANNEL ACCESS #c ADD mara VOICE" ] (sendsOf AccessAdd withAccount)
                    , \_ -> Expect.equal [ wire "CHANNEL ACCESS #c DEL mara OP" ] (sendsOf (AccessDel "mara" "OP") mine)
                    , \_ -> Expect.equal [ wire "CHANNEL ACCESS #c DEL mara FOUNDER" ] (sendsOf (AccessDel "mara" "ADMIN") mine)
                    , \_ -> Expect.equal [] (sendsOf AccessAdd mine)
                    ]
                    ()
        , test "an unknown access level is ignored" <|
            \_ -> Expect.equal mine (Tuple.first (upd ctx (AccessLevelInput "AKICK") mine))
        , test "auto-kick: a bare name becomes name!*@*, account: and extbans stay, reason is one param" <|
            \_ ->
                let
                    add mask reason =
                        mine |> withDraft (\d -> { d | akickMask = mask, akickReason = reason })
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL AKICK #c LIST" ] (sendsOf AkickLoad mine)
                    , \_ -> Expect.equal [ wire "CHANNEL AKICK #c ADD troll!*@*" ] (sendsOf AkickAdd (add "troll" ""))
                    , \_ -> Expect.equal [ wire "CHANNEL AKICK #c ADD troll!*@* :Spam wave" ] (sendsOf AkickAdd (add "troll" "Spam wave"))
                    , \_ -> Expect.equal [ wire "CHANNEL AKICK #c ADD account:badbot" ] (sendsOf AkickAdd (add "account:badbot" ""))
                    , \_ -> Expect.equal [ wire "CHANNEL AKICK #c ADD *!*@evil.example" ] (sendsOf AkickAdd (add "*!*@evil.example" ""))
                    , \_ -> Expect.equal [ wire "CHANNEL AKICK #c DEL troll!*@*" ] (sendsOf (AkickDel "troll!*@*") mine)
                    , \_ -> Expect.equal [] (sendsOf AkickAdd (add "   " ""))
                    ]
                    ()
        , test "successor: show, set, clear" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ wire "SUCCESSOR #c SHOW" ] (sendsOf SuccessorLoad mine)
                    , \_ -> Expect.equal [ wire "SUCCESSOR #c SET mara" ] (sendsOf SuccessorSet (mine |> withDraft (\d -> { d | successor = "mara" })))
                    , \_ -> Expect.equal [ wire "SUCCESSOR #c CLEAR" ] (sendsOf SuccessorClear mine)
                    , \_ -> Expect.equal [] (sendsOf SuccessorSet mine)
                    ]
                    ()
        , test "LISTCHANS needs an account" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ wire "LISTCHANS" ] (sendsOf MyRoomsLoad Chanserv.blank)
                    , \_ -> Expect.equal [] (upd { ctx | account = Nothing } MyRoomsLoad Chanserv.blank |> Tuple.second |> sends)
                    ]
                    ()
        , test "dropping the registration asks twice" <|
            \_ ->
                let
                    ( asked, askFx ) =
                        upd ctx DropAsk mine
                in
                Expect.all
                    [ \_ -> Expect.equal [] (sends askFx)
                    , \_ -> Expect.equal True asked.confirmDrop
                    , \_ -> Expect.equal [ wire "CHANNEL DROP #c" ] (sendsOf DropConfirm asked)
                    , \_ -> Expect.equal False (Tuple.first (upd ctx DropCancel asked)).confirmDrop
                    ]
                    ()
        , test "rule toggles flip from the current mode string" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +S" ] (sendsOf (RuleToggle 'S') mine)
                    , \_ -> Expect.equal [ wire "MODE #c +C" ] (sendsOf (RuleToggle 'C') mine)
                    , \_ -> Expect.equal [ wire "MODE #c -S" ] (upd { ctx | modes = "+ntS" } (RuleToggle 'S') mine |> Tuple.second |> sends)
                    ]
                    ()
        , test "network-operator rules need a network operator; unknown letters do nothing" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (sendsOf (RuleToggle 'O') mine)
                    , \_ -> Expect.equal [ wire "MODE #c +O" ] (upd { ctx | isOper = True } (RuleToggle 'O') mine |> Tuple.second |> sends)
                    , \_ -> Expect.equal [] (sendsOf (RuleToggle 'z') mine)
                    , \_ -> Expect.equal [] (upd { ctx | isOp = False } (RuleToggle 'S') mine |> Tuple.second |> sends)
                    ]
                    ()
        , test "forward target must be another room" <|
            \_ ->
                let
                    to target =
                        mine |> withDraft (\d -> { d | forward = target })
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +f #overflow" ] (sendsOf ForwardSave (to "#overflow"))
                    , \_ -> Expect.equal [] (sendsOf ForwardSave (to "#c"))
                    , \_ -> Expect.equal [] (sendsOf ForwardSave (to "overflow"))
                    , \_ -> Expect.equal [ wire "MODE #c -f" ] (sendsOf ForwardClear mine)
                    ]
                    ()
        , test "join throttle is joins:seconds within bounds" <|
            \_ ->
                let
                    spec joins secs =
                        mine |> withDraft (\d -> { d | throttleJoins = joins, throttleSecs = secs })
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +j 5:10" ] (sendsOf ThrottleSave (spec "5" "10"))
                    , \_ -> Expect.equal [] (sendsOf ThrottleSave (spec "0" "10"))
                    , \_ -> Expect.equal [] (sendsOf ThrottleSave (spec "5" "86401"))
                    , \_ -> Expect.equal [] (sendsOf ThrottleSave (spec "x" "10"))
                    , \_ -> Expect.equal [ wire "MODE #c -j" ] (sendsOf ThrottleClear mine)
                    ]
                    ()
        , test "timed rules ask the server (TEMPMODE ADD +flag milliseconds); ending cancels and reverts" <|
            \_ ->
                let
                    timed letter minutes =
                        mine |> withDraft (\d -> { d | timedLetter = letter, timedMinutes = minutes })

                    ( started, startFx ) =
                        upd ctx TimedStart (timed "m" "10")
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "TEMPMODE ADD #c +m 600000" ] (sends startFx)
                    , \_ -> Expect.equal [ { letter = 'm', until = 1000000 + 600000 } ] (Chanserv.timedOf "#c" started)
                    , \_ -> Expect.equal [ wire "TEMPMODE CANCEL #c m", wire "MODE #c -m" ] (sendsOf (TimedEnd 'm') started)
                    , \_ -> Expect.equal [] (Chanserv.timedOf "#c" (Tuple.first (upd ctx (TimedEnd 'm') started)))
                    , \_ -> Expect.equal [] (sendsOf TimedStart (timed "b" "10"))
                    , \_ -> Expect.equal [] (sendsOf TimedStart (timed "m" "0"))
                    , \_ -> Expect.equal [] (sendsOf TimedStart (timed "m" "10081"))
                    ]
                    ()
        , test "a server that has no TEMPMODE (421) drops the pending timed rule" <|
            \_ ->
                let
                    ( started, _ ) =
                        upd ctx TimedStart (mine |> withDraft (\d -> { d | timedLetter = "m", timedMinutes = "5" }))

                    sent =
                        Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 1000000 } [ wire "TEMPMODE ADD #c +m 300000" ] started

                    after =
                        foldAll [ ":srv.test 421 me TEMPMODE :Unknown command" ] sent
                in
                Expect.all
                    [ \_ -> Expect.equal [] (Chanserv.timedOf "#c" after)
                    , \_ -> Expect.equal (Just "Timed rules aren't available on this server.") (Chanserv.statusOf "#c" "rules" after |> Maybe.map .text)
                    ]
                    ()
        , test "timed rules lapse on the clock; an off-switch ends them too" <|
            \_ ->
                let
                    ( started, _ ) =
                        upd ctx TimedStart (mine |> withDraft (\d -> { d | timedLetter = "m", timedMinutes = "5" }))
                in
                Expect.all
                    [ \_ -> Expect.equal 1 (List.length (Chanserv.timedOf "#c" (Chanserv.tick 1100000 started)))
                    , \_ -> Expect.equal [] (Chanserv.timedOf "#c" (Chanserv.tick 1400000 started))
                    , \_ -> Expect.equal [] (Chanserv.timedOf "#c" (foldAll [ ":kai!k@h MODE #c -m" ] started))
                    ]
                    ()
        , test "welcome and goodbye write PROP ONJOIN / ONPART; blank removes; unchanged is a no-op" <|
            \_ ->
                let
                    draft w g =
                        Chanserv.blank |> withDraft (\d -> { d | welcome = w, goodbye = g })

                    fx msg state =
                        upd ctx msg state |> Tuple.second
                in
                Expect.all
                    [ \_ -> Expect.equal [ WriteProp { channel = "#c", key = "ONJOIN", value = "Welcome aboard" } ] (fx WelcomeSave (draft "  Welcome aboard " ""))
                    , \_ -> Expect.equal [ WriteProp { channel = "#c", key = "ONPART", value = "Fair winds" } ] (fx GoodbyeSave (draft "" "Fair winds"))
                    , \_ -> Expect.equal [] (fx WelcomeSave (draft "" ""))
                    , \_ -> Expect.equal [ WriteProp { channel = "#c", key = "ONJOIN", value = "" } ] (upd { ctx | props = Dict.fromList [ ( "ONJOIN", "old" ) ] } WelcomeSave (draft "" "") |> Tuple.second)
                    , \_ -> Expect.equal [] (upd { ctx | isOp = False } WelcomeSave (draft "x" "") |> Tuple.second)
                    ]
                    ()
        , test "the welcome draft is cut at the server's 255 limit" <|
            \_ ->
                Expect.equal 255 (String.length (Chanserv.blank |> Chanserv.update ctx (WelcomeInput (String.repeat 400 "a")) |> Tuple.first |> .drafts |> .welcome))
        , test "slow mode writes SLOWMODE seconds (0 is off) and SLOWVOICE 0 or 1, never an empty value" <|
            \_ ->
                let
                    draft secs voice =
                        Chanserv.blank |> withDraft (\d -> { d | slow = secs, slowVoice = voice })

                    fx state props =
                        upd { ctx | props = props } SlowSave state |> Tuple.second
                in
                Expect.all
                    [ \_ ->
                        Expect.equal
                            [ WriteProp { channel = "#c", key = "SLOWMODE", value = "30" } ]
                            (fx (draft "30" False) Dict.empty)
                    , \_ ->
                        Expect.equal
                            [ WriteProp { channel = "#c", key = "SLOWMODE", value = "60" }, WriteProp { channel = "#c", key = "SLOWVOICE", value = "0" } ]
                            (fx (draft "60" True) Dict.empty)
                    , \_ ->
                        Expect.equal
                            [ WriteProp { channel = "#c", key = "SLOWMODE", value = "0" } ]
                            (fx (draft "0" False) (Dict.fromList [ ( "SLOWMODE", "30" ) ]))
                    , \_ ->
                        Expect.equal
                            [ WriteProp { channel = "#c", key = "SLOWVOICE", value = "1" } ]
                            (fx (draft "30" False) (Dict.fromList [ ( "SLOWMODE", "30" ), ( "SLOWVOICE", "0" ) ]))
                    , \_ -> Expect.equal [] (fx (draft "30" False) (Dict.fromList [ ( "SLOWMODE", "30" ) ]))
                    , \_ -> Expect.equal [] (fx (draft "86401" False) Dict.empty)
                    , \_ -> Expect.equal [] (fx (draft "-1" False) Dict.empty)
                    ]
                    ()
        , test "mute and unmute put +Z / -Z with the name mask" <|
            \_ ->
                let
                    muted =
                        foldAll [ ":srv.test 728 me #c ann!*@* kai 100", ":srv.test 728 me #c ann!u@h kai 101", ":srv.test 729 me #c :End of channel quiet list" ] Chanserv.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +Z ann!*@*" ] (sendsOf (MuteMember "#c" "ann") Chanserv.blank)
                    , \_ -> Expect.equal [ wire "MODE #c -Z ann!*@*" ] (sendsOf (UnmuteMember "#c" "ann") Chanserv.blank)
                    , \_ -> Expect.equal [ wire "MODE #c -Z ann!*@*", wire "MODE #c -Z ann!u@h" ] (sendsOf (UnmuteMember "#c" "ann") muted)
                    , \_ -> Expect.equal [] (upd { ctx | live = False } (MuteMember "#c" "ann") Chanserv.blank |> Tuple.second |> sends)
                    , \_ -> Expect.equal [] (sendsOf (MuteMember "#c" "a b") Chanserv.blank)
                    ]
                    ()
        , test "the room actions do nothing without an open room or a live socket" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (upd { ctx | room = Nothing } Register Chanserv.blank |> Tuple.second |> sends)
                    , \_ -> Expect.equal [] (upd { ctx | live = False } (RuleToggle 'S') Chanserv.blank |> Tuple.second |> sends)
                    , \_ -> Expect.equal [] (upd { ctx | live = False } DropConfirm mine |> Tuple.second |> sends)
                    ]
                    ()
        ]


foldReplies : Test
foldReplies =
    describe "server replies fold into state"
        [ test "INFO reply: registration, then desc and url lines" <|
            \_ ->
                let
                    state =
                        foldAll
                            [ ":srv.test NOTICE me :channel=#c founder=kai flags=0 mlock=+nt topiclock=false guard=true private=false"
                            , ":srv.test NOTICE me :  desc: A calm room"
                            , ":srv.test NOTICE me :  url: https://x.example"
                            ]
                            Chanserv.blank
                in
                case Chanserv.registrationOf "#c" state of
                    Registered info ->
                        Expect.all
                            [ \_ -> Expect.equal "kai" info.founder
                            , \_ -> Expect.equal "A calm room" info.desc
                            , \_ -> Expect.equal "https://x.example" info.url
                            , \_ -> Expect.equal True info.guard
                            , \_ -> Expect.equal True (Chanserv.isFounder (Just "KAI") info)
                            , \_ -> Expect.equal False (Chanserv.isFounder Nothing info)
                            ]
                            ()

                    other ->
                        Expect.fail ("not registered: " ++ Debug.toString other)
        , test "FAIL CHANNEL CHANNEL_UNKNOWN after our INFO means 'not registered', not an error" <|
            \_ ->
                let
                    asked =
                        Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "CHANNEL INFO #c" ] Chanserv.blank

                    ( after, effects ) =
                        fld ":srv.test FAIL CHANNEL CHANNEL_UNKNOWN :No such registered channel" asked
                in
                Expect.all
                    [ \_ -> Expect.equal RegNone (Chanserv.registrationOf "#c" after)
                    , \_ -> Expect.equal [] effects
                    , \_ -> Expect.equal Nothing (Chanserv.statusOf "#c" "reg" after)
                    ]
                    ()
        , test "FAIL CHANNEL ACCOUNT_REQUIRED after INFO means signed out" <|
            \_ ->
                let
                    asked =
                        Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "CHANNEL INFO #c" ] Chanserv.blank
                in
                Expect.equal RegSignedOut (Chanserv.registrationOf "#c" (foldAll [ ":srv.test FAIL CHANNEL ACCOUNT_REQUIRED :You must be logged in" ] asked))
        , test "a refused SET shows the plain reason on the registration area" <|
            \_ ->
                let
                    asked =
                        Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "CHANNEL SET #c GUARD on" ] mine

                    after =
                        foldAll [ ":srv.test FAIL CHANNEL ACCESS_DENIED :Only the founder may SET channel properties" ] asked
                in
                Expect.equal (Just "Only the room's founder can do that.") (Chanserv.statusOf "#c" "reg" after |> Maybe.map .text)
        , test "REGISTER success records the founder and asks for INFO" <|
            \_ ->
                let
                    ( after, effects ) =
                        fld ":srv.test NOTICE me :Channel #c registered to kai" Chanserv.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL INFO #c" ] (sends effects)
                    , \_ ->
                        case Chanserv.registrationOf "#c" after of
                            Registered info ->
                                Expect.equal "kai" info.founder

                            _ ->
                                Expect.fail "not registered"
                    ]
                    ()
        , test "REGISTER of a registered room learns who holds it" <|
            \_ ->
                let
                    asked =
                        Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "CHANNEL REGISTER #c" ] Chanserv.blank

                    ( after, effects ) =
                        fld ":srv.test FAIL CHANNEL CHANNEL_EXISTS :Channel registration failed" asked
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL INFO #c" ] (sends effects)
                    , \_ -> Expect.equal (Just "This room is already registered.") (Chanserv.statusOf "#c" "reg" after |> Maybe.map .text)
                    ]
                    ()
        , test "SET receipts update INFO fields" <|
            \_ ->
                let
                    after =
                        foldAll
                            [ ":srv.test NOTICE me :Channel #c MLOCK set to +ntS"
                            , ":srv.test NOTICE me :Channel #c topiclock off"
                            , ":srv.test NOTICE me :Channel #c guard on"
                            , ":srv.test NOTICE me :Channel #c private on"
                            , ":srv.test NOTICE me :Channel #c URL set to https://y.example"
                            , ":srv.test NOTICE me :Channel #c KEEPTOPIC on"
                            ]
                            mine
                in
                case Chanserv.registrationOf "#c" after of
                    Registered info ->
                        Expect.all
                            [ \_ -> Expect.equal "+ntS" info.mlock
                            , \_ -> Expect.equal False info.topiclock
                            , \_ -> Expect.equal True info.guard
                            , \_ -> Expect.equal True info.private
                            , \_ -> Expect.equal "https://y.example" info.url
                            , \_ -> Expect.equal (Just True) (Dict.get "#c" after.keepTopic)
                            ]
                            ()

                    _ ->
                        Expect.fail "lost registration"
        , test "ACCESS list rows buffer until the end line, then replace the list" <|
            \_ ->
                let
                    state =
                        Tuple.first (upd ctx AccessLoad mine)
                            |> foldAll [ ":srv.test NOTICE me :ACCESS #c kai FOUNDER", ":srv.test NOTICE me :ACCESS #c mara OP" ]

                    done =
                        foldAll [ ":srv.test NOTICE me :End of ACCESS list for #c" ] state
                in
                Expect.all
                    [ \_ -> Expect.equal [] (Chanserv.accessOf "#c" state).entries
                    , \_ -> Expect.equal True (Chanserv.accessOf "#c" state).loading
                    , \_ -> Expect.equal [ { account = "kai", level = "FOUNDER" }, { account = "mara", level = "OP" } ] (Chanserv.accessOf "#c" done).entries
                    , \_ -> Expect.equal False (Chanserv.accessOf "#c" done).loading
                    ]
                    ()
        , test "ACCESS add / remove receipts" <|
            \_ ->
                let
                    listed =
                        foldAll [ ":srv.test NOTICE me :ACCESS #c mara OP" ] mine

                    removed =
                        foldAll [ ":srv.test NOTICE me :ACCESS removed #c mara OP" ] listed
                in
                Expect.all
                    [ \_ -> Expect.equal [ { account = "mara", level = "OP" } ] (Chanserv.accessOf "#c" listed).entries
                    , \_ -> Expect.equal [] (Chanserv.accessOf "#c" removed).entries
                    , \_ -> Expect.equal (Just "Removed mara.") (Chanserv.statusOf "#c" "access" removed |> Maybe.map .text)
                    ]
                    ()
        , test "an ACCESS FAIL clears the loading mark and shows words" <|
            \_ ->
                let
                    loading =
                        Tuple.first (upd ctx AccessLoad mine)
                            |> Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "CHANNEL ACCESS #c LIST" ]

                    after =
                        foldAll [ ":srv.test FAIL CHANNEL ACCESS_DENIED :Channel access list failed" ] loading
                in
                Expect.all
                    [ \_ -> Expect.equal False (Chanserv.accessOf "#c" after).loading
                    , \_ -> Expect.equal (Just "Only the room's founder can do that.") (Chanserv.statusOf "#c" "access" after |> Maybe.map .text)
                    ]
                    ()
        , test "AKICK list rows carry reasons; add asks for the list again; remove drops the row" <|
            \_ ->
                let
                    loaded =
                        Tuple.first (upd ctx AkickLoad mine)
                            |> foldAll [ ":srv.test NOTICE me :AKICK #c troll!*@* :Spam wave", ":srv.test NOTICE me :AKICK #c account:bot :Auto-kicked", ":srv.test NOTICE me :End of AKICK list for #c" ]

                    ( _, addFx ) =
                        fld ":srv.test NOTICE me :AKICK added on #c: new!*@*" loaded

                    removed =
                        foldAll [ ":srv.test NOTICE me :AKICK removed on #c: troll!*@*" ] loaded
                in
                Expect.all
                    [ \_ -> Expect.equal [ { mask = "troll!*@*", reason = "Spam wave" }, { mask = "account:bot", reason = "Auto-kicked" } ] (Chanserv.akickOf "#c" loaded).entries
                    , \_ -> Expect.equal [ wire "CHANNEL AKICK #c LIST" ] (sends addFx)
                    , \_ -> Expect.equal [ { mask = "account:bot", reason = "Auto-kicked" } ] (Chanserv.akickOf "#c" removed).entries
                    ]
                    ()
        , test "successor replies" <|
            \_ ->
                let
                    set =
                        foldAll [ ":srv.test NOTICE me :SUCCESSOR: #c successor is mara" ] mine

                    none =
                        foldAll [ ":srv.test NOTICE me :SUCCESSOR: #c has no successor" ] set

                    asked =
                        Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "SUCCESSOR #c CLEAR" ] set
                in
                Expect.all
                    [ \_ -> Expect.equal (Just (Just "mara")) (Chanserv.successorOf "#c" set)
                    , \_ -> Expect.equal (Just Nothing) (Chanserv.successorOf "#c" none)
                    , \_ -> Expect.equal (Just Nothing) (Chanserv.successorOf "#c" (foldAll [ ":srv.test NOTICE me :SUCCESSOR: cleared" ] asked))
                    , \_ ->
                        Expect.equal (Just "There's no Onyx account with that name.")
                            (Chanserv.statusOf "#c" "successor" (foldAll [ ":srv.test FAIL SUCCESSOR ACCOUNT_UNKNOWN :no such account" ] asked) |> Maybe.map .text)
                    ]
                    ()
        , test "LISTCHANS rows collect until the end line" <|
            \_ ->
                let
                    loading =
                        Tuple.first (upd ctx MyRoomsLoad Chanserv.blank)

                    done =
                        foldAll [ ":srv.test NOTICE me :LISTCHANS #a FOUNDER", ":srv.test NOTICE me :LISTCHANS #b OP", ":srv.test NOTICE me :End of LISTCHANS (2)" ] loading
                in
                Expect.all
                    [ \_ -> Expect.equal True done.myRooms.loaded
                    , \_ -> Expect.equal [ { account = "#a", level = "FOUNDER" }, { account = "#b", level = "OP" } ] done.myRooms.rooms
                    ]
                    ()
        , test "a founder-level LISTCHANS row lets a non-INFO founder manage" <|
            \_ ->
                let
                    state =
                        registeredBy "someone"
                            |> foldAll [ ":srv.test NOTICE me :LISTCHANS #c ADMIN", ":srv.test NOTICE me :End of LISTCHANS (1)" ]
                in
                Expect.all
                    [ \_ -> Expect.equal True (Chanserv.canManage (Just "kai") "#c" state)
                    , \_ -> Expect.equal False (Chanserv.canManage Nothing "#c" state)
                    , \_ -> Expect.equal False (Chanserv.canManage (Just "kai") "#c" (registeredBy "someone"))
                    ]
                    ()
        , test "an MLOCK refusal in MODE becomes a calm toast" <|
            \_ ->
                let
                    ( _, effects ) =
                        fld ":srv.test NOTICE me :Mode +i is locked by services (MLOCK +nt-i)" Chanserv.blank
                in
                Expect.equal [ Chanserv.Toast ToneError "That rule is locked" (Just "The room's founder locked it. Only they can change it.") ] effects
        , test "live MODE lines keep +f and +j current (324 never reports them)" <|
            \_ ->
                let
                    set =
                        foldAll [ ":kai!k@h MODE #c +fj #overflow 5:10" ] Chanserv.blank

                    off =
                        foldAll [ ":kai!k@h MODE #c -f" ] set
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "#overflow") (Dict.get "#c" set.forwards)
                    , \_ -> Expect.equal (Just "5:10") (Dict.get "#c" set.throttles)
                    , \_ -> Expect.equal Nothing (Dict.get "#c" off.forwards)
                    , \_ -> Expect.equal (Just "5:10") (Dict.get "#c" off.throttles)
                    ]
                    ()
        , test "unrelated lines change nothing" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal ( mine, [] ) (fld ":srv.test 001 me :Welcome" mine)
                    , \_ -> Expect.equal ( mine, [] ) (fld ":nick!u@h PRIVMSG #c :hello" mine)
                    , \_ -> Expect.equal ( mine, [] ) (fld ":srv.test NOTICE other :[#c] not for me" mine)
                    ]
                    ()
        ]


deleteRoom : Test
deleteRoom =
    describe "Delete room checks registration first (D7)"
        [ test "an unknown room is asked about before anything is dropped" <|
            \_ ->
                let
                    ( state, effects ) =
                        Chanserv.beginDelete { channel = "#c", signedIn = True, others = [ "ann" ], founderRank = True } Chanserv.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL INFO #c" ] (sends effects)
                    , \_ -> Expect.notEqual Nothing state.pendingDelete
                    ]
                    ()
        , test "a registered room is dropped first, then emptied and left" <|
            \_ ->
                let
                    ( asked, askFx ) =
                        Chanserv.beginDelete { channel = "#c", signedIn = True, others = [ "ann" ], founderRank = True } Chanserv.blank

                    ( informed, infoFx ) =
                        fld ":srv.test NOTICE me :channel=#c founder=kai flags=0 mlock=+nt topiclock=false guard=false private=false" asked

                    ( _, dropFx ) =
                        fld ":srv.test NOTICE me :Channel #c dropped" informed
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL INFO #c" ] (sends askFx)
                    , \_ -> Expect.equal [ wire "CHANNEL DROP #c" ] (sends infoFx)
                    , \_ ->
                        Expect.equal
                            [ wire "MODE #c +si"
                            , wire "CLEAR #c USERS"
                            , wire "PART #c :Room deleted"
                            ]
                            (sends dropFx)
                    ]
                    ()
        , test "an unregistered room (CHANNEL_UNKNOWN) is emptied and left without a DROP" <|
            \_ ->
                let
                    asked =
                        Chanserv.beginDelete { channel = "#c", signedIn = True, others = [ "ann", "bo" ], founderRank = False } Chanserv.blank
                            |> Tuple.first
                            |> Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "CHANNEL INFO #c" ]

                    ( after, effects ) =
                        fld ":srv.test FAIL CHANNEL CHANNEL_UNKNOWN :No such registered channel" asked
                in
                Expect.all
                    [ \_ ->
                        Expect.equal
                            [ wire "MODE #c +si"
                            , wire "KICK #c ann :Room deleted"
                            , wire "KICK #c bo :Room deleted"
                            , wire "PART #c :Room deleted"
                            ]
                            (sends effects)
                    , \_ -> Expect.equal Nothing after.pendingDelete
                    , \_ -> Expect.equal RegNone (Chanserv.registrationOf "#c" after)
                    , \_ -> Expect.equal True (List.member (Chanserv.Toast ToneOk "Deleted #c" Nothing) effects)
                    ]
                    ()
        , test "a guest has nothing to drop: straight to emptying the room" <|
            \_ ->
                let
                    ( state, effects ) =
                        Chanserv.beginDelete { channel = "#c", signedIn = False, others = [], founderRank = True } Chanserv.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +si", wire "CLEAR #c USERS", wire "PART #c :Room deleted" ] (sends effects)
                    , \_ -> Expect.equal Nothing state.pendingDelete
                    ]
                    ()
        , test "known-unregistered goes straight to emptying; known-registered goes straight to DROP" <|
            \_ ->
                let
                    input =
                        { channel = "#c", signedIn = True, others = [], founderRank = True }

                    knownNone =
                        Chanserv.blank
                            |> Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "CHANNEL INFO #c" ]
                            |> foldAll [ ":srv.test FAIL CHANNEL CHANNEL_UNKNOWN :x" ]
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL DROP #c" ] (sends (Tuple.second (Chanserv.beginDelete input mine)))
                    , \_ -> Expect.equal [ wire "MODE #c +si", wire "CLEAR #c USERS", wire "PART #c :Room deleted" ] (sends (Tuple.second (Chanserv.beginDelete input knownNone)))
                    ]
                    ()
        , test "a DROP refused for someone else's room says so and keeps the room" <|
            \_ ->
                let
                    asked =
                        Chanserv.beginDelete { channel = "#c", signedIn = True, others = [], founderRank = True } (registeredBy "someone")
                            |> Tuple.first
                            |> Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 0 } [ wire "CHANNEL DROP #c" ]

                    ( after, effects ) =
                        fld ":srv.test FAIL CHANNEL ACCESS_DENIED :Channel drop failed" asked
                in
                Expect.all
                    [ \_ -> Expect.equal [ Chanserv.Toast ToneError "Couldn't delete #c" (Just "This room is registered to another account. Only its founder can delete it.") ] effects
                    , \_ -> Expect.equal Nothing after.pendingDelete
                    ]
                    ()
        , test "a socket close abandons an unanswered delete" <|
            \_ ->
                let
                    ( asked, _ ) =
                        Chanserv.beginDelete { channel = "#c", signedIn = True, others = [], founderRank = True } Chanserv.blank
                in
                Expect.equal Nothing (Chanserv.reset asked).pendingDelete
        , test "through App: a signed-in owner of an unregistered room INFOs, then empties and leaves" <|
            \_ ->
                let
                    owner =
                        { stewardRoomBase | accountName = Just "kai" }

                    ( asked, askOut ) =
                        update (StewardConfirmDelete "#c") { owner | stewardTypedName = "#c" }

                    ( answered, answerOut ) =
                        feed asked ":srv.test FAIL CHANNEL CHANNEL_UNKNOWN :No such registered channel"
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL INFO #c" ] (lines askOut)
                    , \_ -> Expect.equal [ wire "MODE #c +si", wire "CLEAR #c USERS", wire "PART #c :Room deleted" ] (lines answerOut)
                    , \_ -> Expect.equal Nothing answered.chanserv.pendingDelete
                    ]
                    ()
        , test "through App: a registered room is dropped first" <|
            \_ ->
                let
                    owner =
                        { stewardRoomBase | accountName = Just "kai" }

                    ( asked, _ ) =
                        update (StewardConfirmDelete "#c") { owner | stewardTypedName = "#c" }

                    ( informed, infoOut ) =
                        feed asked ":srv.test NOTICE me :channel=#c founder=kai flags=0 mlock=+nt topiclock=false guard=false private=false"

                    ( _, dropOut ) =
                        feed informed ":srv.test NOTICE me :Channel #c dropped"
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "CHANNEL DROP #c" ] (lines infoOut)
                    , \_ -> Expect.equal [ wire "MODE #c +si", wire "CLEAR #c USERS", wire "PART #c :Room deleted" ] (lines dropOut)
                    ]
                    ()
        ]


{-| A signed-out-by-default owner of #c (Q + q) with one other member. -}
stewardRoomBase : Model
stewardRoomBase =
    let
        base =
            room { op = True, props = [], modes = "+nt" }

        member nick modes =
            ( nick, { nick = nick, modes = Set.fromList modes, away = False } )
    in
    { base
        | channels =
            Dict.map
                (\_ ch -> { ch | members = Dict.fromList [ member "me" [ 'Q', 'q', 'o' ], member "ann" [] ] })
                base.channels
    }


joinRefusals : Test
joinRefusals =
    describe "join refusals say why (D9)"
        [ test "489 TLS-only becomes the join prompt and an inbox row, in words" <|
            \_ ->
                let
                    ( after, _ ) =
                        feed (room { op = False, props = [], modes = "" }) ":srv.test 489 me #secure :Cannot join channel (+S) - TLS required"
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "#secure") (Maybe.map .channel after.channelJoinPrompt)
                    , \_ -> Expect.equal (Just "This room only accepts encrypted (TLS) connections, and this connection doesn't qualify") (Maybe.map .error after.channelJoinPrompt)
                    , \_ -> Expect.equal [ "#secure needs a secure connection. This room only accepts encrypted (TLS) connections, and this connection doesn't qualify." ] (List.map .text after.notifications)
                    , \_ -> Expect.equal (Just "489") (Dict.get "#secure" after.chanserv.refusal)
                    ]
                    ()
        , test "520 names operators or administrators" <|
            \_ ->
                let
                    refuse text =
                        feed blank (":srv.test 520 me #staff :" ++ text) |> Tuple.first |> .notifications |> List.map .text
                in
                Expect.all
                    [ \_ -> Expect.equal [ "#staff is for network operators. Only Onyx network operators can join." ] (refuse "Cannot join channel (+O) - IRC operator required")
                    , \_ -> Expect.equal [ "#staff is for network administrators. Only Onyx network administrators can join." ] (refuse "Cannot join channel (+A) - server administrator required")
                    ]
                    ()
        , test "477 for a room asks to sign in; 477 for a DM says the person takes signed-in messages only" <|
            \_ ->
                let
                    notes line =
                        feed blank line |> Tuple.first |> .notifications |> List.map .text
                in
                Expect.all
                    [ \_ -> Expect.equal [ "#c is for signed-in accounts. Sign in to your Onyx account to join." ] (notes ":srv.test 477 me #c :Cannot join channel (+a) - you must be authenticated")
                    , \_ -> Expect.equal [ "bob only takes messages from signed-in accounts. Sign in to message them." ] (notes ":srv.test 477 me bob :Cannot message this user (+R: identify to a registered account)")
                    ]
                    ()
        , test "480 join throttle says to try again; the raw numeric stays in the service log" <|
            \_ ->
                let
                    ( after, _ ) =
                        feed blank ":srv.test 480 me #c :Cannot join channel (+j) - join rate exceeded, try again shortly"
                in
                Expect.all
                    [ \_ -> Expect.equal [ "#c is busy. Too many people are joining right now. Try again in a moment." ] (List.map .text after.notifications)
                    , \_ -> Expect.equal [ "#c Cannot join channel (+j) - join rate exceeded, try again shortly" ] (List.take 1 after.serviceLog)
                    ]
                    ()
        , test "470 forwarded: a toast names where the server sent us" <|
            \_ ->
                let
                    ( after, _ ) =
                        feed blank ":srv.test 470 me #bouncy #overflow :Forwarding to another channel"
                in
                case after.toasts of
                    toast :: _ ->
                        Expect.all
                            [ \_ -> Expect.equal "You were sent to #overflow" toast.title
                            , \_ -> Expect.equal (Just "#bouncy couldn't take you, so it forwarded you to #overflow.") toast.description
                            ]
                            ()

                    [] ->
                        Expect.fail "no toast"
        , test "470 clears a pending browser join so the browser does not hang" <|
            \_ ->
                let
                    pending =
                        { blank | browserPendingJoin = Just "#bouncy", browserAttemptedJoin = Just "#bouncy", browserJoinPhase = BrowserJoinPending }

                    ( after, _ ) =
                        feed pending ":srv.test 470 me #bouncy #overflow :Forwarding to another channel"
                in
                Expect.equal BrowserJoinIdle after.browserJoinPhase
        , test "a malformed 470 (no target room) is only logged" <|
            \_ ->
                let
                    ( after, _ ) =
                        feed blank ":srv.test 470 me #bouncy"
                in
                Expect.all
                    [ \_ -> Expect.equal [] after.toasts
                    , \_ -> Expect.equal [] after.notifications
                    ]
                    ()
        , test "our own JOIN settles the refusal and any knock for that room" <|
            \_ ->
                let
                    refused =
                        feed blank ":srv.test 473 me #vip :Cannot join channel (+i)" |> Tuple.first

                    asked =
                        Tuple.first (update (ChanservMsg (AskToJoin "#vip")) { refused | connection = Live })

                    joined =
                        feed asked ":me!u@h JOIN #vip" |> Tuple.first
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "473") (Dict.get "#vip" refused.chanserv.refusal)
                    , \_ -> Expect.notEqual Nothing (Chanserv.knockStateOf "#vip" asked.chanserv)
                    , \_ -> Expect.equal Nothing (Dict.get "#vip" joined.chanserv.refusal)
                    , \_ -> Expect.equal Nothing (Chanserv.knockStateOf "#vip" joined.chanserv)
                    ]
                    ()
        ]


knockTests : Test
knockTests =
    describe "KNOCK / Ask to join"
        [ test "Ask to join sends KNOCK with the note and marks the request as sending" <|
            \_ ->
                let
                    state =
                        Chanserv.blank |> withDraft (\d -> { d | knockNote = "friend of mara" })

                    ( after, effects ) =
                        upd ctx (AskToJoin "#vip") state
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "KNOCK #vip :friend of mara" ] (sends effects)
                    , \_ ->
                        case Chanserv.knockStateOf "#vip" after of
                            Just (Chanserv.KnockSending _) ->
                                Expect.pass

                            other ->
                                Expect.fail (Debug.toString other)
                    ]
                    ()
        , test "Ask to join needs a live socket and a real room name" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (upd { ctx | live = False } (AskToJoin "#vip") Chanserv.blank |> Tuple.second |> sends)
                    , \_ -> Expect.equal [] (sendsOf (AskToJoin "vip") Chanserv.blank)
                    ]
                    ()
        , test "711 delivered, 713 refused, 714 already inside" <|
            \_ ->
                let
                    ( delivered, deliveredFx ) =
                        fld ":srv.test 711 me #vip :Your KNOCK has been delivered" Chanserv.blank

                    ( refused, refusedFx ) =
                        fld ":srv.test 713 me #open :Channel is open" Chanserv.blank

                    ( inside, insideFx ) =
                        fld ":srv.test 714 me #vip :You are already on that channel" delivered
                in
                Expect.all
                    [ \_ -> Expect.equal (Just Chanserv.KnockDelivered) (Chanserv.knockStateOf "#vip" delivered)
                    , \_ -> Expect.equal [ Chanserv.Toast ToneOk "Asked to join #vip" (Just "The hosts were told. They can invite you in.") ] deliveredFx
                    , \_ -> Expect.equal (Just Chanserv.KnockRefused) (Chanserv.knockStateOf "#open" refused)
                    , \_ -> Expect.equal [ Chanserv.Toast ToneError "#open doesn't take join requests" (Just "Ask someone in the room for an invite or the key.") ] refusedFx
                    , \_ -> Expect.equal Nothing (Chanserv.knockStateOf "#vip" inside)
                    , \_ -> Expect.equal [ ClearJoinPrompt "#vip", Chanserv.Toast ToneInfo "You're already in #vip" Nothing ] insideFx
                    ]
                    ()
        , test "a knock that nobody confirms lapses to 'no hosts around'" <|
            \_ ->
                let
                    sent =
                        Chanserv.noteSends { gapFor = \_ -> 0, nowMs = 1000 } [ wire "KNOCK #vip" ] Chanserv.blank
                in
                Expect.all
                    [ \_ -> Expect.equal (Just (Chanserv.KnockSending 1000)) (Chanserv.knockStateOf "#vip" (Chanserv.tick 5000 sent))
                    , \_ -> Expect.equal (Just Chanserv.KnockNoHosts) (Chanserv.knockStateOf "#vip" (Chanserv.tick 8000 sent))
                    ]
                    ()
        , test "710 gives hosts an inbox row, a toast, and a pending request with an Invite" <|
            \_ ->
                let
                    ( after, effects ) =
                        fld ":srv.test 710 me #c nova!n@host.example :may I come in?" Chanserv.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ Inbox { text = "nova asks to join #c", from = Just "nova", channel = Just "#c" }, Chanserv.Toast ToneInfo "nova asks to join #c" (Just "Open the inbox to invite them.") ] effects
                    , \_ -> Expect.equal [ { channel = "#c", nick = "nova", reason = "may I come in?", invited = False } ] (List.map (\k -> { channel = k.channel, nick = k.nick, reason = k.reason, invited = k.invited }) after.knocks)
                    ]
                    ()
        , test "the same person knocking twice replaces the first request" <|
            \_ ->
                let
                    after =
                        foldAll [ ":srv.test 710 me #c nova!n@h :one", ":srv.test 710 me #c nova!n@h :two" ] Chanserv.blank
                in
                Expect.equal [ "two" ] (List.map .reason after.knocks)
        , test "Invite sends INVITE nick #channel once and then reads Invited" <|
            \_ ->
                let
                    state =
                        foldAll [ ":srv.test 710 me #c nova!n@h :hi" ] Chanserv.blank

                    id =
                        List.head state.knocks |> Maybe.map .id |> Maybe.withDefault -1

                    ( invited, fx ) =
                        upd ctx (InviteKnock id) state
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "INVITE nova #c" ] (sends fx)
                    , \_ -> Expect.equal [] (sendsOf (InviteKnock id) invited)
                    , \_ -> Expect.equal [ True ] (List.map .invited invited.knocks)
                    , \_ -> Expect.equal [] (upd { ctx | live = False } (InviteKnock id) state |> Tuple.second |> sends)
                    ]
                    ()
        , test "Dismiss removes a request without sending anything" <|
            \_ ->
                let
                    state =
                        foldAll [ ":srv.test 710 me #c nova!n@h :hi" ] Chanserv.blank

                    id =
                        List.head state.knocks |> Maybe.map .id |> Maybe.withDefault -1
                in
                Expect.equal [] (Tuple.first (upd ctx (DismissKnock id) state)).knocks
        , test "a junk 710 (bad channel or nick) is ignored" <|
            \_ ->
                Expect.equal ( Chanserv.blank, [] ) (fld ":srv.test 710 me notachannel nova!n@h :hi" Chanserv.blank)
        , test "only twenty requests are kept" <|
            \_ ->
                let
                    many =
                        List.range 1 30 |> List.map (\i -> ":srv.test 710 me #c user" ++ String.fromInt i ++ "!u@h :hi")
                in
                Expect.equal 20 (List.length (foldAll many Chanserv.blank).knocks)
        , test "through App: KNOCK from the join prompt goes on the wire and 711 settles it" <|
            \_ ->
                let
                    refused =
                        feed (room { op = False, props = [], modes = "" }) ":srv.test 473 me #vip :Cannot join channel (+i)" |> Tuple.first

                    ( asked, askOut ) =
                        update (ChanservMsg (AskToJoin "#vip")) refused

                    ( delivered, _ ) =
                        feed asked ":srv.test 711 me #vip :Your KNOCK has been delivered"
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "KNOCK #vip" ] (lines askOut)
                    , \_ -> Expect.equal (Just Chanserv.KnockDelivered) (Chanserv.knockStateOf "#vip" delivered.chanserv)
                    , \_ -> Expect.equal True (List.any (\t -> t.title == "Asked to join #vip") delivered.toasts)
                    ]
                    ()
        , test "through App: a host's 710 lands in the inbox" <|
            \_ ->
                let
                    ( after, _ ) =
                        feed (room { op = True, props = [], modes = "" }) ":srv.test 710 me #c nova!n@host.example :wants to join"
                in
                Expect.equal [ "nova asks to join #c" ] (List.map .text after.notifications)
        ]


maskLists : Test
maskLists =
    describe "+Z / +e / +I lists"
        [ test "quiet, exception and invite-exception rows land in their own lists" <|
            \_ ->
                let
                    state =
                        foldAll
                            [ ":srv.test 728 me #c ann!*@* kai 1700000000"
                            , ":srv.test 729 me #c :End of channel quiet list"
                            , ":srv.test 348 me #c *!*@trusted.example kai 1700000001"
                            , ":srv.test 349 me #c :End of channel exception list"
                            , ":srv.test 346 me #c bo!*@* kai 1700000002"
                            , ":srv.test 347 me #c :End of channel invite exception list"
                            ]
                            Chanserv.blank

                    masks letter =
                        (Chanserv.listOf "#c" letter state).entries |> List.map .mask
                in
                Expect.all
                    [ \_ -> Expect.equal [ "ann!*@*" ] (masks 'Z')
                    , \_ -> Expect.equal [ "*!*@trusted.example" ] (masks 'e')
                    , \_ -> Expect.equal [ "bo!*@*" ] (masks 'I')
                    , \_ -> Expect.equal True (Chanserv.listOf "#c" 'Z' state).loaded
                    , \_ -> Expect.equal 1700000000 (List.head (Chanserv.listOf "#c" 'Z' state).entries |> Maybe.map .setAt |> Maybe.withDefault 0)
                    ]
                    ()
        , test "an empty list ends loaded and empty" <|
            \_ ->
                let
                    state =
                        foldAll [ ":srv.test 729 me #c :End of channel quiet list" ] Chanserv.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [] (Chanserv.listOf "#c" 'Z' state).entries
                    , \_ -> Expect.equal True (Chanserv.listOf "#c" 'Z' state).loaded
                    ]
                    ()
        , test "a new load replaces the old rows when its end line arrives" <|
            \_ ->
                let
                    first =
                        foldAll [ ":srv.test 728 me #c old!*@* kai 1", ":srv.test 729 me #c :End" ] Chanserv.blank

                    ( loading, fx ) =
                        upd ctx (ListLoad 'Z') first

                    done =
                        foldAll [ ":srv.test 728 me #c new!*@* kai 2", ":srv.test 729 me #c :End" ] loading
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +Z" ] (sends fx)
                    , \_ -> Expect.equal [ "old!*@*" ] (List.map .mask (Chanserv.listOf "#c" 'Z' loading).entries)
                    , \_ -> Expect.equal [ "new!*@*" ] (List.map .mask (Chanserv.listOf "#c" 'Z' done).entries)
                    ]
                    ()
        , test "adding and removing: the selected tab picks the letter" <|
            \_ ->
                let
                    onTab letter =
                        Tuple.first (upd ctx (ListTab letter) Chanserv.blank) |> withDraft (\d -> { d | listMask = "ann" })
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +Z ann!*@*" ] (sendsOf ListAdd (onTab 'Z'))
                    , \_ -> Expect.equal [ wire "MODE #c +e ann!*@*" ] (sendsOf ListAdd (onTab 'e'))
                    , \_ -> Expect.equal [ wire "MODE #c +I ann!*@*" ] (sendsOf ListAdd (onTab 'I'))
                    , \_ -> Expect.equal [ wire "MODE #c -e ann!*@*" ] (sendsOf (ListDel 'e' "ann!*@*") Chanserv.blank)
                    , \_ -> Expect.equal [] (sendsOf (ListDel 'b' "ann!*@*") Chanserv.blank)
                    ]
                    ()
        , test "switching to an unloaded tab asks the server; a loaded or loading tab does not" <|
            \_ ->
                let
                    ( onE, fx ) =
                        upd ctx (ListTab 'e') Chanserv.blank

                    ( _, again ) =
                        upd ctx (ListTab 'e') onE
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +e" ] (sends fx)
                    , \_ -> Expect.equal [] (sends again)
                    , \_ -> Expect.equal 'e' onE.listTab
                    , \_ -> Expect.equal 'Z' (Tuple.first (upd ctx (ListTab 'b') Chanserv.blank)).listTab
                    ]
                    ()
        , test "masks may be names, full masks or extbans; spaces are refused" <|
            \_ ->
                let
                    tryAdd mask =
                        sendsOf ListAdd (Chanserv.blank |> withDraft (\d -> { d | listMask = mask }))
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "MODE #c +Z nick!*@*" ] (tryAdd "nick")
                    , \_ -> Expect.equal [ wire "MODE #c +Z nick!u@h" ] (tryAdd "nick!u@h")
                    , \_ -> Expect.equal [ wire "MODE #c +Z $a:acct" ] (tryAdd "$a:acct")
                    , \_ -> Expect.equal [] (tryAdd "a b")
                    ]
                    ()
        ]


slowMode : Test
slowMode =
    describe "slow mode"
        [ test "404 (slowmode) restarts the countdown for that room and reads in words" <|
            \_ ->
                let
                    ( after, _ ) =
                        fld ":srv.test 404 me #c :Cannot send to channel (slowmode)" Chanserv.blank
                in
                Expect.equal (Just 1000000) (Dict.get "#c" after.slowSent)
        , test "a 404 for another reason leaves it alone" <|
            \_ ->
                Expect.equal Chanserv.blank (Tuple.first (fld ":srv.test 404 me #c :Cannot send to channel (+n)" Chanserv.blank))
        , test "copy never shows the raw text" <|
            \_ -> Expect.equal "Slow mode is on in #c. Wait a moment, then send again." (Chanserv.slowmodeCopy "#c")
        , test "through App: a refused send shows slow-mode copy in the inbox and no raw numeric" <|
            \_ ->
                let
                    ( after, _ ) =
                        feed (room { op = False, props = [], modes = "" }) ":srv.test 404 me #c :Cannot send to channel (slowmode)"
                in
                Expect.all
                    [ \_ -> Expect.equal [ "Slow mode is on in #c. Wait a moment, then send again." ] (List.map .text after.notifications)
                    ]
                    ()
        , test "through App: a send starts the countdown and the next send is held with plain copy" <|
            \_ ->
                let
                    slow =
                        slowRoom { op = False, voiceExempt = True }

                    typed =
                        update (ComposerInput "hello") slow |> Tuple.first

                    ( sent, firstOut ) =
                        update ComposerSend typed

                    again =
                        update (ComposerInput "again") { sent | nowMs = 15000 } |> Tuple.first

                    ( held, heldOut ) =
                        update ComposerSend again

                    later =
                        update (ComposerInput "later") { sent | nowMs = 40000 } |> Tuple.first

                    ( released, releasedOut ) =
                        update ComposerSend later
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "PRIVMSG #c hello" ] (lines firstOut)
                    , \_ -> Expect.equal [] (lines heldOut)
                    , \_ -> Expect.equal (Just "Slow mode is on in #c. You can send again in 20s.") held.composerError
                    , \_ -> Expect.equal "again" held.composer
                    , \_ -> Expect.equal [ wire "PRIVMSG #c later" ] (lines releasedOut)
                    , \_ -> Expect.equal Nothing released.composerError
                    ]
                    ()
        , test "through App: hosts are exempt unless SLOWVOICE is 0" <|
            \_ ->
                let
                    exempt =
                        slowRoom { op = True, voiceExempt = True }

                    strict =
                        slowRoom { op = True, voiceExempt = False }

                    twice model =
                        let
                            first =
                                update (ComposerInput "one") model |> Tuple.first |> update ComposerSend |> Tuple.first

                            second =
                                update (ComposerInput "two") { first | nowMs = 6000 } |> Tuple.first |> update ComposerSend
                        in
                        lines (Tuple.second second)
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "PRIVMSG #c two" ] (twice exempt)
                    , \_ -> Expect.equal [] (twice strict)
                    ]
                    ()
        , test "slash commands are not channel messages and are never held" <|
            \_ ->
                let
                    slow =
                        slowRoom { op = False, voiceExempt = True }

                    first =
                        update (ComposerInput "hello") slow |> Tuple.first |> update ComposerSend |> Tuple.first

                    ( _, out ) =
                        update (ComposerInput "/topic") { first | nowMs = 6000 } |> Tuple.first |> update ComposerSend
                in
                Expect.equal False (List.isEmpty out)
        ]


{-| #c with SLOWMODE 30 (and SLOWVOICE 0 unless voice is exempt), clock at 5s. -}
slowRoom : { op : Bool, voiceExempt : Bool } -> Model
slowRoom o =
    let
        base =
            room
                { op = o.op
                , props =
                    ( "SLOWMODE", "30" )
                        :: (if o.voiceExempt then
                                []

                            else
                                [ ( "SLOWVOICE", "0" ) ]
                           )
                , modes = ""
                }
    in
    { base | nowMs = 5000 }


welcome : Test
welcome =
    describe "room welcome message"
        [ test "ONJOIN notice for a room we are in becomes a system row once per session" <|
            \_ ->
                let
                    base =
                        room { op = False, props = [], modes = "" }

                    ( first, _ ) =
                        feed base ":srv.test NOTICE me :[#c] Welcome aboard. Be kind."

                    ( second, _ ) =
                        feed first ":srv.test NOTICE me :[#c] Welcome aboard. Be kind."

                    bodies model =
                        Dict.get "#c" model.channels |> Maybe.map (.messages >> List.map (\m -> ( m.msgType, m.body ))) |> Maybe.withDefault []
                in
                Expect.all
                    [ \_ -> Expect.equal [ ( "system", "Welcome message: Welcome aboard. Be kind." ) ] (bodies first)
                    , \_ -> Expect.equal (bodies first) (bodies second)
                    ]
                    ()
        , test "a changed welcome shows again" <|
            \_ ->
                let
                    base =
                        room { op = False, props = [], modes = "" }

                    after =
                        feedAll [ ":srv.test NOTICE me :[#c] one", ":srv.test NOTICE me :[#c] two" ] base
                in
                Expect.equal 2 (Dict.get "#c" after.channels |> Maybe.map (.messages >> List.length) |> Maybe.withDefault 0)
        , test "ONPART notice for a room we just left is a toast, not a row" <|
            \_ ->
                let
                    ( after, _ ) =
                        feed blank ":srv.test NOTICE me :[#gone] Fair winds"
                in
                Expect.all
                    [ \_ -> Expect.equal [ "From #gone" ] (List.map .title after.toasts)
                    , \_ -> Expect.equal [ Just "Fair winds" ] (List.map .description after.toasts)
                    ]
                    ()
        , test "notices addressed to someone else or without a channel tag are ignored" <|
            \_ ->
                let
                    base =
                        room { op = False, props = [], modes = "" }

                    after =
                        feedAll [ ":srv.test NOTICE other :[#c] not me", ":srv.test NOTICE me :[notachannel] hi", ":srv.test NOTICE me :[#c] " ] base
                in
                Expect.equal 0 (Dict.get "#c" after.channels |> Maybe.map (.messages >> List.length) |> Maybe.withDefault -1)
        ]


-- VIEWS


query : Model -> Query.Single App.Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


has : String -> Model -> Expect.Expectation
has id model =
    query model |> Query.has [ testid id ]


lacks : String -> Model -> Expect.Expectation
lacks id model =
    query model |> Query.hasNot [ testid id ]


opened : Model -> Model
opened model =
    Tuple.first (update (RoomSettingsMsg RoomSettings.Open) model)


views : Test
views =
    describe "surfaces"
        [ test "Room settings for a host: welcome and slow mode, lists, registration, more rules" <|
            \_ ->
                let
                    model =
                        opened (room { op = True, props = [], modes = "+nt" })
                in
                Expect.all
                    [ has "chset-pace"
                    , has "chset-welcome"
                    , has "chset-slow"
                    , has "chset-lists"
                    , has "chset-registration"
                    , has "chset-more-rules"
                    ]
                    model
        , test "Room settings for a member hides every host tool; slow mode and welcome show only when set" <|
            \_ ->
                let
                    quiet =
                        opened (room { op = False, props = [], modes = "+nt" })

                    set =
                        opened (room { op = False, props = [ ( "SLOWMODE", "30" ), ( "ONJOIN", "Hello there" ) ], modes = "+nt" })
                in
                Expect.all
                    [ \_ -> lacks "chset-pace" quiet
                    , \_ -> lacks "chset-lists" quiet
                    , \_ -> lacks "chset-registration" quiet
                    , \_ -> lacks "chset-more-rules" quiet
                    , \_ -> lacks "chset-welcome" set
                    , \_ -> has "chset-slow-readonly" set
                    , \_ -> has "chset-welcome-readonly" set
                    ]
                    ()
        , test "the registration area walks guest, unregistered, registered" <|
            \_ ->
                let
                    base =
                        room { op = True, props = [], modes = "+nt" }

                    guest =
                        opened { base | accountName = Nothing }

                    signedIn =
                        opened base

                    unregistered =
                        feed signedIn ":srv.test FAIL CHANNEL CHANNEL_UNKNOWN :No such registered channel" |> Tuple.first

                    registered =
                        feed signedIn ":srv.test NOTICE me :channel=#c founder=kai flags=0 mlock=+nt topiclock=false guard=false private=false" |> Tuple.first
                in
                Expect.all
                    [ \_ -> has "chset-reg-signin" guest
                    , \_ -> lacks "chset-register" guest
                    , \_ -> has "chset-reg-checking" signedIn
                    , \_ -> has "chset-register" unregistered
                    , \_ -> has "chset-reg-founder" registered
                    , \_ -> has "chset-account-access" registered
                    , \_ -> has "chset-akick" registered
                    , \_ -> has "chset-drop" registered
                    ]
                    ()
        , test "opening Room settings asks for registration (signed in) and the mask list (host)" <|
            \_ ->
                let
                    ( _, out ) =
                        update (RoomSettingsMsg RoomSettings.Open) (room { op = True, props = [], modes = "+nt" })

                    sent =
                        lines out
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member (wire "CHANNEL INFO #c") sent)
                    , \_ -> Expect.equal True (List.member (wire "MODE #c +Z") sent)
                    ]
                    ()
        , test "a registered room that is someone else's shows who, without the editors" <|
            \_ ->
                let
                    model =
                        feed (opened (room { op = True, props = [], modes = "+nt" })) ":srv.test NOTICE me :channel=#c founder=zed flags=0 mlock=+nt topiclock=false guard=false private=false"
                            |> Tuple.first
                in
                Expect.all
                    [ has "chset-reg-founder"
                    , lacks "chset-akick"
                    , lacks "chset-drop"
                    ]
                    model
        , test "the join prompt card shows the reason and the right action for each refusal" <|
            \_ ->
                let
                    refuse line =
                        feed blank line |> Tuple.first |> (\m -> { m | connection = Live })
                in
                Expect.all
                    [ \_ -> has "join-prompt-knock" (refuse ":srv.test 473 me #vip :Cannot join channel (+i)")
                    , \_ -> has "join-prompt-key" (refuse ":srv.test 475 me #keyed :Cannot join channel (+k)")
                    , \_ -> has "join-prompt-knock" (refuse ":srv.test 475 me #keyed :Cannot join channel (+k)")
                    , \_ -> has "join-prompt-retry" (refuse ":srv.test 480 me #busy :Cannot join channel (+j)")
                    , \_ -> has "join-prompt" (refuse ":srv.test 489 me #secure :Cannot join channel (+S) - TLS required")
                    , \_ -> lacks "join-prompt-knock" (refuse ":srv.test 489 me #secure :Cannot join channel (+S) - TLS required")
                    , \_ -> lacks "join-prompt-knock" (refuse ":srv.test 520 me #staff :Cannot join channel (+O) - IRC operator required")
                    , \_ -> lacks "join-prompt-knock" (refuse ":srv.test 474 me #banned :Cannot join channel (+b)")
                    ]
                    ()
        , test "the join prompt card says 'Request sent' once the hosts were told, and goes away on dismiss" <|
            \_ ->
                let
                    refused =
                        feed blank ":srv.test 473 me #vip :Cannot join channel (+i)" |> Tuple.first |> (\m -> { m | connection = Live })

                    asked =
                        update (ChanservMsg (AskToJoin "#vip")) refused |> Tuple.first

                    delivered =
                        feed asked ":srv.test 711 me #vip :Your KNOCK has been delivered" |> Tuple.first

                    dismissed =
                        update (ChanservMsg (DismissPrompt "#vip")) delivered |> Tuple.first
                in
                Expect.all
                    [ \_ -> has "join-prompt-knocked" delivered
                    , \_ -> lacks "join-prompt-knock" delivered
                    , \_ -> lacks "join-prompt" dismissed
                    ]
                    ()
        , test "the key form joins with the typed key" <|
            \_ ->
                let
                    refused =
                        feed blank ":srv.test 475 me #keyed :Cannot join channel (+k)" |> Tuple.first |> (\m -> { m | connection = Live })

                    typed =
                        update (ChanservMsg (JoinKeyInput "s3cret")) refused |> Tuple.first

                    ( after, out ) =
                        update (ChanservMsg (JoinWithKey "#keyed")) typed
                in
                Expect.all
                    [ \_ -> Expect.equal [ wire "JOIN #keyed s3cret" ] (lines out)
                    , \_ -> Expect.equal "" after.chanserv.drafts.joinKey
                    , \_ -> Expect.equal Nothing after.channelJoinPrompt
                    ]
                    ()
        , test "a host sees Invite on the knock row; others and used requests do not" <|
            \_ ->
                let
                    host =
                        feed (room { op = True, props = [], modes = "" }) ":srv.test 710 me #c nova!n@h :hi" |> Tuple.first

                    inbox m =
                        { m | showNotificationCenter = True }

                    invited =
                        case host.chanserv.knocks of
                            k :: _ ->
                                update (ChanservMsg (InviteKnock k.id)) host |> Tuple.first

                            [] ->
                                host
                in
                Expect.all
                    [ \_ -> has "knock-invite" (inbox host)
                    , \_ -> lacks "knock-invite" (inbox invited)
                    , \_ -> has "knock-invited" (inbox invited)
                    , \_ -> lacks "knock-invite" { blank | showNotificationCenter = True }
                    ]
                    ()
        , test "the composer shows the slow-mode line, with a countdown after a send" <|
            \_ ->
                let
                    idle =
                        slowRoom { op = False, voiceExempt = True }

                    sentOnce =
                        update (ComposerInput "hi") idle |> Tuple.first |> update ComposerSend |> Tuple.first

                    host =
                        slowRoom { op = True, voiceExempt = True }
                in
                Expect.all
                    [ \_ -> has "composer-slowmode" idle
                    , \_ -> Expect.equal False (View.Chanserv.composerSlowWaiting idle)
                    , \_ -> Expect.equal True (View.Chanserv.composerSlowWaiting sentOnce)
                    , \_ -> lacks "composer-slowmode" host
                    , \_ -> lacks "composer-slowmode" (room { op = False, props = [], modes = "" })
                    ]
                    ()
        , test "Mute shows for hosts on other people only, and flips to Unmute when the list names them" <|
            \_ ->
                let
                    host =
                        room { op = True, props = [], modes = "" }

                    member =
                        room { op = False, props = [], modes = "" }

                    text node =
                        node |> Query.fromHtml |> Query.has [ testid "member-mute", Selector.text "Mute" ]

                    muted =
                        { host | chanserv = foldAll [ ":srv.test 728 me #c ann!*@* kai 1", ":srv.test 729 me #c :End" ] host.chanserv }
                in
                Expect.all
                    [ \_ -> text (View.Chanserv.muteButton host "#c" "ann")
                    , \_ -> Query.fromHtml (View.Chanserv.muteButton host "#c" "me") |> Query.hasNot [ testid "member-mute" ]
                    , \_ -> Query.fromHtml (View.Chanserv.muteButton member "#c" "ann") |> Query.hasNot [ testid "member-mute" ]
                    , \_ -> Query.fromHtml (View.Chanserv.muteButton muted "#c" "ann") |> Query.has [ testid "member-mute", Selector.text "Unmute" ]
                    ]
                    ()
        ]
