module UserModesTest exposing (suite)

{-| v3/gap-usermodes — wire-line vectors and state folds for the privacy
user modes, caller-id, server-side SILENCE, the MEMO mailbox, DEFER,
AUTOJOIN, SETNAME, WHOWAS and SEEN. Every inbound vector is the shape the
Onyx Server really writes (`/home/kain/onyx-server`, read-only).
-}

import Dict
import Expect
import Json.Decode as Decode
import Json.Encode as Encode
import Set
import Test exposing (Test, describe, test)
import UserModes as U
import Wire


ctx0 : U.Ctx
ctx0 =
    { nick = "kn"
    , account = Just "kn"
    , live = True
    , nowMs = 1.0e12
    , silenceLimit = 3
    , ignored = Set.empty
    , isChannel = \n -> String.startsWith "#" n
    , profileNicks = Set.empty
    , dmPeers = \_ -> []
    , serverPrefix = Nothing
    }


guest : U.Ctx
guest =
    { ctx0 | account = Nothing }


offline : U.Ctx
offline =
    { ctx0 | live = False }


fold : U.Ctx -> String -> U.State -> Maybe { state : U.State, effects : List U.Effect, consume : Bool }
fold c line s =
    U.foldWire c (Wire.parseIrcMessage line) s


foldS : String -> U.State -> U.State
foldS line s =
    case fold ctx0 line s of
        Just r ->
            r.state

        Nothing ->
            s


foldAll : List String -> U.State -> U.State
foldAll lines s =
    List.foldl foldS s lines


sent : List U.Effect -> List String
sent effects =
    List.filterMap
        (\e ->
            case e of
                U.Send line ->
                    Just line

                _ ->
                    Nothing
        )
        effects


upd : U.Ctx -> U.Msg -> U.State -> ( U.State, List U.Effect )
upd =
    U.update


blank : U.State
blank =
    U.blank


withModes : String -> U.State
withModes line =
    foldS line U.blank


suite : Test
suite =
    describe "UserModes (v3/gap-usermodes)"
        [ catalogTests
        , wireBuilderTests
        , modeTests
        , callerIdTests
        , silenceTests
        , memoTests
        , deferTests
        , autojoinTests
        , profileTests
        , persistTests
        ]



-- ── catalog ───────────────────────────────────────────────────────────


catalogTests : Test
catalogTests =
    describe "privacy catalog"
        [ test "only letters the server both accepts and enforces are offered" <|
            \_ ->
                U.privacyModes
                    |> List.map .letter
                    |> List.sort
                    |> String.fromList
                    |> Expect.equal "CPQRgip"
        , test "+D (deaf) is absent: the server accepts it but enforces nothing" <|
            \_ -> Expect.equal False (U.isImplemented 'D')
        , test "bot, hide-oper and oper-only modes are never offered" <|
            \_ ->
                [ 'B', 'H', 'j', 'z', 'M', 'o', 'a', 'x', 'r' ]
                    |> List.map U.isImplemented
                    |> Expect.equal (List.repeat 9 False)
        , test "every offered letter has a title, a description and a unique key" <|
            \_ ->
                let
                    keys =
                        List.map .key U.privacyModes
                in
                Expect.all
                    [ \_ -> Expect.equal (List.length keys) (Set.size (Set.fromList keys))
                    , \_ -> Expect.equal [] (List.filter (\m -> String.isEmpty m.title || String.length m.description < 20) U.privacyModes)
                    ]
                    ()
        , test "a mode the server does not advertise in 004 is not offered" <|
            \_ ->
                let
                    advertised =
                        foldS ":onyx.test 004 kn onyx.test onyx-1 iRgx CHANMODES" U.blank
                in
                Expect.equal [ True, True, True, False, False ]
                    (List.map (U.modeAvailable advertised) [ 'i', 'R', 'g', 'C', 'Q' ])
        , test "before 004 every implemented mode is offered" <|
            \_ -> Expect.equal True (U.modeAvailable U.blank 'C')
        ]



-- ── builders ──────────────────────────────────────────────────────────


wireBuilderTests : Test
wireBuilderTests =
    describe "wire builders"
        [ test "MODE query and change lines" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "MODE kn\r\n") (U.modeQueryLine "kn")
                    , \_ -> Expect.equal (Just "MODE kn +R\r\n") (U.modeLine "kn" [ 'R' ] [])
                    , \_ -> Expect.equal (Just "MODE kn -g\r\n") (U.modeLine "kn" [] [ 'g' ])
                    , \_ -> Expect.equal (Just "MODE kn +iR-g\r\n") (U.modeLine "kn" [ 'i', 'R' ] [ 'g' ])
                    , \_ -> Expect.equal Nothing (U.modeLine "kn" [ 'D', 'o' ] [])
                    , \_ -> Expect.equal Nothing (U.modeLine "bad nick" [ 'R' ] [])
                    ]
                    ()
        , test "ACCEPT glues the sign to the nick" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "ACCEPT +alice\r\n") (U.acceptAddLine "alice")
                    , \_ -> Expect.equal (Just "ACCEPT -alice\r\n") (U.acceptRemoveLine "alice")
                    , \_ -> Expect.equal "ACCEPT *\r\n" U.acceptListLine
                    , \_ -> Expect.equal Nothing (U.acceptAddLine "a b")
                    , \_ -> Expect.equal Nothing (U.acceptAddLine "")
                    ]
                    ()
        , test "SILENCE glues the sign to the mask; bare SILENCE lists" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "SILENCE +bob!*@*\r\n") (U.silenceAddLine "bob!*@*")
                    , \_ -> Expect.equal (Just "SILENCE -bob!*@*\r\n") (U.silenceRemoveLine "bob!*@*")
                    , \_ -> Expect.equal "SILENCE\r\n" U.silenceListLine
                    , \_ -> Expect.equal (Just "bob!*@*") (U.maskForNick "bob")
                    , \_ -> Expect.equal Nothing (U.maskForNick "b o b")
                    , \_ -> Expect.equal (Just "bob") (U.silencedNick "bob!*@*")
                    , \_ -> Expect.equal Nothing (U.silencedNick "*!*@spam.example")
                    , \_ -> Expect.equal Nothing (U.silencedNick "b*b!*@*")
                    ]
                    ()
        , test "MEMO lines" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "MEMO LIST\r\n") (U.memoLine [ "LIST" ])
                    , \_ -> Expect.equal (Just "MEMO CLEAR\r\n") (U.memoLine [ "CLEAR" ])
                    , \_ -> Expect.equal (Just "MEMO FORWARD\r\n") (U.memoLine [ "FORWARD" ])
                    , \_ -> Expect.equal (Just "MEMO FORWARD OFF\r\n") (U.memoLine [ "FORWARD", "OFF" ])
                    , \_ -> Expect.equal (Just "MEMO FORWARD alice\r\n") (U.memoLine [ "FORWARD", "alice" ])
                    , \_ -> Expect.equal (Just "MEMO IGNORE LIST\r\n") (U.memoLine [ "IGNORE", "LIST" ])
                    , \_ -> Expect.equal (Just "MEMO IGNORE ADD alice\r\n") (U.memoLine [ "IGNORE", "ADD", "alice" ])
                    , \_ -> Expect.equal (Just "MEMO IGNORE DEL alice\r\n") (U.memoLine [ "IGNORE", "DEL", "alice" ])
                    , \_ -> Expect.equal (Just "MEMO SEND alice :see you at six\r\n") (U.memoLine [ "SEND", "alice", "see you at six" ])
                    , \_ -> Expect.equal (Just "MEMO SEND alice hi\r\n") (U.memoLine [ "SEND", "alice", "hi" ])
                    , \_ -> Expect.equal Nothing (U.memoLine [ "SEND", "alice", "" ])
                    , \_ -> Expect.equal Nothing (U.memoLine [ "SEND", "alice", "two\r\nlines" ])
                    , \_ -> Expect.equal Nothing (U.memoLine [ "SEND", "bad name", "hi" ])
                    , \_ -> Expect.equal Nothing (U.memoLine [ "SEND", "alice", String.repeat 401 "x" ])
                    , \_ -> Expect.equal Nothing (U.memoLine [ "NUKE" ])
                    ]
                    ()
        , test "DEFER AT carries unix ms, the channel and the text" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "DEFER AT 1700000000000 #lounge :see you at six\r\n") (U.deferAtLine 1700000000000 "#lounge" "see you at six")
                    , \_ -> Expect.equal (Just "DEFER AT 1700000000000 #lounge hi\r\n") (U.deferAtLine 1700000000000 "#lounge" "hi")
                    , \_ -> Expect.equal Nothing (U.deferAtLine 0 "#lounge" "hi")
                    , \_ -> Expect.equal Nothing (U.deferAtLine 1700000000000 "#lounge" "")
                    , \_ -> Expect.equal Nothing (U.deferAtLine 1700000000000 "#lounge" "a\nb")
                    , \_ -> Expect.equal Nothing (U.deferAtLine 1700000000000 "#lounge" (String.repeat 401 "x"))
                    , \_ -> Expect.equal Nothing (U.deferAtLine 1700000000000 "#lo unge" "hi")
                    ]
                    ()
        , test "DEFER CRON is a builder only (no control offers a send nobody can cancel)" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "DEFER CRON 0 9 * * 1 #lounge :stand-up now\r\n") (U.deferCronLine "0 9 * * 1" "#lounge" "stand-up now")
                    , \_ -> Expect.equal Nothing (U.deferCronLine "0 9 * *" "#lounge" "x")
                    , \_ -> Expect.equal Nothing (U.deferCronLine "0 9 * * mon" "#lounge" "x")
                    , \_ -> Expect.equal Nothing (U.deferCronLine "0 9 * * 1" "#lounge" "")
                    , \_ -> Expect.equal Nothing (U.deferCronLine "0 9 * * 1 2" "#lounge" "x")
                    ]
                    ()
        , test "DEFER counts bytes, not characters" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal 5 (U.utf8Bytes "é€")
                    , \_ -> Expect.equal 4 (U.utf8Bytes "😀")
                    , \_ -> Expect.equal Nothing (U.deferAtLine 1700000000000 "#a" (String.repeat 134 "€"))
                    , \_ -> Expect.notEqual Nothing (U.deferAtLine 1700000000000 "#a" (String.repeat 133 "€"))
                    ]
                    ()
        , test "AUTOJOIN lines" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "AUTOJOIN LIST\r\n") (U.autojoinLine "LIST" Nothing)
                    , \_ -> Expect.equal (Just "AUTOJOIN ADD #lounge\r\n") (U.autojoinLine "ADD" (Just "#lounge"))
                    , \_ -> Expect.equal (Just "AUTOJOIN DEL #lounge\r\n") (U.autojoinLine "DEL" (Just "#lounge"))
                    , \_ -> Expect.equal Nothing (U.autojoinLine "ADD" Nothing)
                    , \_ -> Expect.equal Nothing (U.autojoinLine "ADD" (Just "#a,#b"))
                    ]
                    ()
        , test "SETNAME, WHOWAS and SEEN lines" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "SETNAME :Wren Ito\r\n") (U.setnameLine "Wren Ito")
                    , \_ -> Expect.equal (Just "SETNAME Wren\r\n") (U.setnameLine "Wren")
                    , \_ -> Expect.equal Nothing (U.setnameLine "   ")
                    , \_ -> Expect.equal Nothing (U.setnameLine (String.repeat 101 "x"))
                    , \_ -> Expect.equal (Just "SETNAME :a b\r\n") (U.setnameLine "a\u{0007}\r\n b")
                    , \_ -> Expect.equal (Just "WHOWAS wren 1\r\n") (U.whowasLine "wren")
                    , \_ -> Expect.equal (Just "SEEN wren\r\n") (U.seenLine "wren")
                    , \_ -> Expect.equal Nothing (U.seenLine "w ren")
                    ]
                    ()
        ]



-- ── modes ─────────────────────────────────────────────────────────────


modeTests : Test
modeTests =
    describe "modes"
        [ test "a fresh connection asks for the modes and reapplies the saved real name" <|
            \_ ->
                let
                    saved =
                        { blank | realname = "Wren Ito" }

                    ( state, effects ) =
                        U.onConnected ctx0 saved
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MODE kn\r\n", "SETNAME :Wren Ito\r\n" ] (sent effects)
                    , \_ -> Expect.equal True state.reassert
                    , \_ -> Expect.equal False state.modesKnown
                    ]
                    ()
        , test "221 seeds the switches" <|
            \_ ->
                let
                    state =
                        withModes ":onyx.test 221 kn :+iRx"
                in
                Expect.all
                    [ \_ -> Expect.equal True (U.modeOn state 'i')
                    , \_ -> Expect.equal True (U.modeOn state 'R')
                    , \_ -> Expect.equal False (U.modeOn state 'g')
                    , \_ -> Expect.equal True state.modesKnown
                    ]
                    ()
        , test "221 on a fresh connection turns back on what this browser had on" <|
            \_ ->
                let
                    ( fresh, _ ) =
                        U.onConnected ctx0 { blank | wanted = Set.fromList [ 'R', 'g' ] }
                in
                case fold ctx0 ":onyx.test 221 kn :+Rx" fresh of
                    Just r ->
                        Expect.all
                            [ \_ -> Expect.equal [ "MODE kn +g\r\n", "MODE kn\r\n" ] (sent r.effects)
                            , \_ -> Expect.equal True (U.modePending r.state 'g')
                            , \_ -> Expect.equal False r.consume
                            ]
                            ()

                    Nothing ->
                        Expect.fail "221 not folded"
        , test "a saved wish for a mode the server no longer advertises is not sent" <|
            \_ ->
                let
                    ( fresh, _ ) =
                        U.onConnected ctx0 { blank | wanted = Set.fromList [ 'C' ], advertised = Just (Set.fromList [ 'i', 'R' ]) }
                in
                case fold ctx0 ":onyx.test 221 kn :+x" fresh of
                    Just r ->
                        Expect.equal [] (sent r.effects)

                    Nothing ->
                        Expect.fail "221 not folded"
        , test "the live MODE echo flips a switch and clears its pending state" <|
            \_ ->
                let
                    ( toggled, _ ) =
                        upd ctx0 (U.ToggleMode 'R') (withModes ":onyx.test 221 kn :+x")

                    echoed =
                        foldS ":kn!u@host MODE kn :+R" toggled
                in
                Expect.all
                    [ \_ -> Expect.equal True (U.modeOn echoed 'R')
                    , \_ -> Expect.equal False (U.modePending echoed 'R')
                    ]
                    ()
        , test "an echo for another nick, or a channel, is not ours" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (fold ctx0 ":bob!u@host MODE bob :+R" U.blank)
                    , \_ -> Expect.equal Nothing (fold ctx0 ":bob!u@host MODE #lounge +o kn" U.blank)
                    ]
                    ()
        , test "the echo is an observer: App still folds it" <|
            \_ ->
                case fold ctx0 ":kn!u@host MODE kn :+R" U.blank of
                    Just r ->
                        Expect.equal False r.consume

                    Nothing ->
                        Expect.fail "MODE not observed"
        , test "turning a switch on sends the change then a query, and remembers it" <|
            \_ ->
                let
                    ( state, effects ) =
                        upd ctx0 (U.ToggleMode 'g') (withModes ":onyx.test 221 kn :+x")
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MODE kn +g\r\n", "MODE kn\r\n" ] (sent effects)
                    , \_ -> Expect.equal True (List.member U.Persist effects)
                    , \_ -> Expect.equal True (U.modeOn state 'g')
                    , \_ -> Expect.equal True (Set.member 'g' state.wanted)
                    ]
                    ()
        , test "turning a switch off sends -X and forgets it" <|
            \_ ->
                let
                    on =
                        withModes ":onyx.test 221 kn :+R"

                    ( state, effects ) =
                        upd ctx0 (U.ToggleMode 'R') { on | wanted = Set.fromList [ 'R' ] }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MODE kn -R\r\n", "MODE kn\r\n" ] (sent effects)
                    , \_ -> Expect.equal False (U.modeOn state 'R')
                    , \_ -> Expect.equal False (Set.member 'R' state.wanted)
                    ]
                    ()
        , test "a refused change snaps back when the follow-up 221 lands" <|
            \_ ->
                let
                    ( pending, _ ) =
                        upd ctx0 (U.ToggleMode 'R') (withModes ":onyx.test 221 kn :+x")

                    settled =
                        foldS ":onyx.test 221 kn :+x" pending
                in
                Expect.all
                    [ \_ -> Expect.equal True (U.modeOn pending 'R')
                    , \_ -> Expect.equal False (U.modeOn settled 'R')
                    ]
                    ()
        , test "an unoffered letter does nothing, offline says so" <|
            \_ ->
                let
                    ( same, none ) =
                        upd ctx0 (U.ToggleMode 'o') U.blank

                    ( off, noneOff ) =
                        upd offline (U.ToggleMode 'R') U.blank
                in
                Expect.all
                    [ \_ -> Expect.equal ( U.blank, [] ) ( same, none )
                    , \_ -> Expect.equal [] noneOff
                    , \_ -> Expect.equal True (Maybe.map .error off.modeStatus == Just True)
                    ]
                    ()
        , test "stored wishes arriving after 221 reassert immediately" <|
            \_ ->
                let
                    known =
                        withModes ":onyx.test 221 kn :+x"

                    raw =
                        Decode.decodeString Decode.value "{\"v\":1,\"wanted\":\"R\"}" |> Result.withDefault Encode.null

                    ( state, effects ) =
                        upd ctx0 (U.Loaded raw) known
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MODE kn +R\r\n", "MODE kn\r\n" ] (sent effects)
                    , \_ -> Expect.equal True (U.modePending state 'R')
                    ]
                    ()
        ]



-- ── caller-id ─────────────────────────────────────────────────────────


callerIdTests : Test
callerIdTests =
    describe "caller-id (+g)"
        [ test "281/282 build the approved list" <|
            \_ ->
                let
                    state =
                        foldAll
                            [ ":onyx.test 281 kn alice :is on your accept list"
                            , ":onyx.test 281 kn bob :is on your accept list"
                            , ":onyx.test 282 kn :End of /ACCEPT list"
                            ]
                            U.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ "alice", "bob" ] state.accepts
                    , \_ -> Expect.equal True state.acceptKnown
                    ]
                    ()
        , test "a second 281/282 pass replaces the first" <|
            \_ ->
                let
                    state =
                        foldAll
                            [ ":onyx.test 281 kn alice :x", ":onyx.test 282 kn :End", ":onyx.test 281 kn carol :x", ":onyx.test 282 kn :End" ]
                            U.blank
                in
                Expect.equal [ "carol" ] state.accepts
        , test "716 tells the sender the person is waiting to approve them, once a minute" <|
            \_ ->
                case fold ctx0 ":onyx.test 716 kn alice :is in +g mode (must be accepted)" U.blank of
                    Just r ->
                        case r.effects of
                            [ U.DmNote note ] ->
                                Expect.all
                                    [ \_ -> Expect.equal "alice" note.peer
                                    , \_ -> Expect.equal True (String.contains "alice approves new conversations first" note.text)
                                    , \_ ->
                                        Expect.equal 0
                                            (fold ctx0 ":onyx.test 716 kn alice :is in +g mode (must be accepted)" r.state
                                                |> Maybe.map (.effects >> List.length)
                                                |> Maybe.withDefault 99
                                            )
                                    ]
                                    ()

                            _ ->
                                Expect.fail "expected exactly one DM note"

                    Nothing ->
                        Expect.fail "716 not folded"
        , test "717 is consumed quietly (716 already said it)" <|
            \_ ->
                case fold ctx0 ":onyx.test 717 kn alice :has been informed that you messaged them" U.blank of
                    Just r ->
                        Expect.all [ \_ -> Expect.equal [] r.effects, \_ -> Expect.equal True r.consume ] ()

                    Nothing ->
                        Expect.fail "717 not folded"
        , test "718 is a message request with a toast and an unseen count" <|
            \_ ->
                case fold ctx0 ":onyx.test 718 kn alice u@cloak.example :is messaging you, and you have umode +g set. Use ACCEPT to allow" U.blank of
                    Just r ->
                        Expect.all
                            [ \_ -> Expect.equal [ "alice" ] (List.map .nick r.state.requests)
                            , \_ -> Expect.equal 1 r.state.requestsUnseen
                            , \_ ->
                                case r.effects of
                                    [ U.Toast t ] ->
                                        Expect.equal "alice wants to message you" t.title

                                    _ ->
                                        Expect.fail "expected one toast"
                            , \_ -> Expect.equal False (String.contains "cloak" (Debug.toString r.state.requests))
                            ]
                            ()

                    Nothing ->
                        Expect.fail "718 not folded"
        , test "a repeat 718 refreshes the request without another toast" <|
            \_ ->
                let
                    line =
                        ":onyx.test 718 kn alice u@h :is messaging you"

                    first =
                        foldS line U.blank

                    again =
                        fold { ctx0 | nowMs = ctx0.nowMs + 5000 } line first
                in
                case again of
                    Just r ->
                        Expect.all
                            [ \_ -> Expect.equal 1 (List.length r.state.requests)
                            , \_ -> Expect.equal [] r.effects
                            , \_ -> Expect.equal 1 r.state.requestsUnseen
                            ]
                            ()

                    Nothing ->
                        Expect.fail "718 not folded"
        , test "a request from someone you blocked is dropped" <|
            \_ ->
                case fold { ctx0 | ignored = Set.fromList [ "alice" ] } ":onyx.test 718 kn Alice u@h :is messaging you" U.blank of
                    Just r ->
                        Expect.all [ \_ -> Expect.equal [] r.state.requests, \_ -> Expect.equal [] r.effects ] ()

                    Nothing ->
                        Expect.fail "718 not folded"
        , test "a request with a hostile nick is dropped" <|
            \_ ->
                case fold ctx0 ":onyx.test 718 kn a,b u@h :x" U.blank of
                    Just r ->
                        Expect.equal [] r.state.requests

                    Nothing ->
                        Expect.fail "718 not folded"
        , test "accepting a request sends ACCEPT +nick and refreshes the list" <|
            \_ ->
                let
                    withRequest =
                        foldS ":onyx.test 718 kn alice u@h :x" U.blank

                    ( state, effects ) =
                        upd ctx0 (U.RequestAccept "alice") withRequest
                in
                Expect.all
                    [ \_ -> Expect.equal [ "ACCEPT +alice\r\n", "ACCEPT *\r\n" ] (sent effects)
                    , \_ -> Expect.equal [] state.requests
                    , \_ -> Expect.equal [ "alice" ] state.accepts
                    ]
                    ()
        , test "accepting offline does nothing but explain" <|
            \_ ->
                let
                    ( state, effects ) =
                        upd offline (U.RequestAccept "alice") U.blank
                in
                Expect.all [ \_ -> Expect.equal [] effects, \_ -> Expect.equal True (state.acceptStatus /= Nothing) ] ()
        , test "dismissing a request sends nothing" <|
            \_ ->
                let
                    withRequest =
                        foldS ":onyx.test 718 kn alice u@h :x" U.blank

                    ( state, effects ) =
                        upd ctx0 (U.RequestDismiss "ALICE") withRequest
                in
                Expect.all [ \_ -> Expect.equal [] state.requests, \_ -> Expect.equal [] effects ] ()
        , test "removing an approved person sends ACCEPT -nick" <|
            \_ ->
                let
                    approved =
                        { blank | accepts = [ "alice", "bob" ] }

                    ( state, effects ) =
                        upd ctx0 (U.AcceptRemove "alice") approved
                in
                Expect.all
                    [ \_ -> Expect.equal [ "ACCEPT -alice\r\n", "ACCEPT *\r\n" ] (sent effects)
                    , \_ -> Expect.equal [ "bob" ] state.accepts
                    ]
                    ()
        , test "typing a name approves it; spaces are refused" <|
            \_ ->
                let
                    ( typed, _ ) =
                        upd ctx0 (U.AcceptDraft "carol") U.blank

                    ( added, effects ) =
                        upd ctx0 U.AcceptAdd typed

                    ( bad, none ) =
                        upd ctx0 U.AcceptAdd { typed | acceptDraft = "two words" }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "ACCEPT +carol\r\n", "ACCEPT *\r\n" ] (sent effects)
                    , \_ -> Expect.equal "" added.acceptDraft
                    , \_ -> Expect.equal [] none
                    , \_ -> Expect.equal (Just True) (Maybe.map .error bad.acceptStatus)
                    ]
                    ()
        , test "approving the people you already message skips the approved and caps the batch" <|
            \_ ->
                let
                    peers =
                        List.map (\i -> "peer" ++ String.fromInt i) (List.range 1 40)

                    ( state, effects ) =
                        upd { ctx0 | dmPeers = \_ -> "alice" :: "#room" :: peers } U.AcceptExistingDms { blank | accepts = [ "Alice" ] }
                in
                Expect.all
                    [ \_ -> Expect.equal 24 (List.length (List.filter (String.startsWith "ACCEPT +") (sent effects)))
                    , \_ -> Expect.equal False (List.member "ACCEPT +alice\r\n" (sent effects))
                    , \_ -> Expect.equal False (List.member "ACCEPT +#room\r\n" (sent effects))
                    , \_ -> Expect.equal 25 (List.length state.accepts)
                    ]
                    ()
        , test "477 for a DM target explains +R; for a room it is App's" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        case fold ctx0 ":onyx.test 477 kn alice :Cannot message this user (+R: identify to a registered account)" U.blank of
                            Just r ->
                                case r.effects of
                                    [ U.DmNote n ] ->
                                        Expect.equal True (String.contains "signed in to an Onyx account" n.text)

                                    _ ->
                                        Expect.fail "expected a DM note"

                            Nothing ->
                                Expect.fail "477 not folded"
                    , \_ -> Expect.equal Nothing (fold ctx0 ":onyx.test 477 kn #vip :You need a registered nick to join" U.blank)
                    ]
                    ()
        ]



-- ── SILENCE ───────────────────────────────────────────────────────────


silenceTests : Test
silenceTests =
    describe "server blocks (SILENCE)"
        [ test "271 is one comma-joined line; 272 ends the list" <|
            \_ ->
                let
                    state =
                        foldAll [ ":onyx.test 271 kn bob!*@*,*!*@spam.example :", ":onyx.test 272 kn :End of SILENCE list" ] U.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ "bob!*@*", "*!*@spam.example" ] state.silenced
                    , \_ -> Expect.equal True state.silenceKnown
                    ]
                    ()
        , test "an empty list is just the 272" <|
            \_ ->
                let
                    state =
                        foldAll [ ":onyx.test 271 kn a!*@* :", ":onyx.test 272 kn :End", ":onyx.test 272 kn :End" ] U.blank
                in
                Expect.equal [] state.silenced
        , test "the echo adds and removes" <|
            \_ ->
                let
                    state =
                        foldAll [ ":kn!u@h SILENCE +bob!*@*", ":kn!u@h SILENCE +carol!*@*", ":kn!u@h SILENCE -bob!*@*" ] U.blank
                in
                Expect.equal [ "carol!*@*" ] state.silenced
        , test "someone else's SILENCE line is not ours" <|
            \_ ->
                Expect.equal Nothing (fold ctx0 ":eve!u@h SILENCE +bob!*@*" U.blank)
        , test "ignoring mirrors to the server only when opted in, signed in and live" <|
            \_ ->
                let
                    on =
                        { blank | serverIgnore = True }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "SILENCE +bob!*@*\r\n" ] (sent (Tuple.second (U.ignoreAdded ctx0 "bob" on)))
                    , \_ -> Expect.equal [] (sent (Tuple.second (U.ignoreAdded ctx0 "bob" U.blank)))
                    , \_ -> Expect.equal [] (sent (Tuple.second (U.ignoreAdded guest "bob" on)))
                    , \_ -> Expect.equal [] (sent (Tuple.second (U.ignoreAdded offline "bob" on)))
                    , \_ -> Expect.equal [] (sent (Tuple.second (U.ignoreAdded ctx0 "bob" { on | silenced = [ "Bob!*@*" ] })))
                    ]
                    ()
        , test "a full server list keeps the block device-only and says so" <|
            \_ ->
                let
                    full =
                        { blank | serverIgnore = True, silenced = [ "a!*@*", "b!*@*", "c!*@*" ] }

                    ( state, effects ) =
                        U.ignoreAdded ctx0 "bob" full
                in
                Expect.all
                    [ \_ -> Expect.equal [] effects
                    , \_ -> Expect.equal (Just True) (Maybe.map .error state.silenceStatus)
                    ]
                    ()
        , test "SILENCE=0 (unadvertised) never reads as full" <|
            \_ ->
                let
                    many =
                        { blank | serverIgnore = True, silenced = List.repeat 50 "x!*@*" }
                in
                Expect.equal False (U.silenceFull { ctx0 | silenceLimit = 0 } many)
        , test "unblocking lifts the server block it mirrored" <|
            \_ ->
                let
                    listed =
                        { blank | silenced = [ "bob!*@*" ] }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "SILENCE -bob!*@*\r\n" ] (sent (Tuple.second (U.ignoreRemoved ctx0 "bob" listed)))
                    , \_ -> Expect.equal [] (sent (Tuple.second (U.ignoreRemoved ctx0 "bob" U.blank)))
                    , \_ -> Expect.equal [] (sent (Tuple.second (U.ignoreRemoved offline "bob" listed)))
                    ]
                    ()
        , test "turning the server mirror on fetches the list once" <|
            \_ ->
                let
                    ( state, effects ) =
                        upd ctx0 (U.ServerIgnoreSet True) U.blank

                    ( again, more ) =
                        upd ctx0 (U.ServerIgnoreSet True) { state | silenceKnown = True }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "SILENCE\r\n" ] (sent effects)
                    , \_ -> Expect.equal [] (sent more)
                    , \_ -> Expect.equal True (List.member U.Persist effects)
                    , \_ -> Expect.equal True again.serverIgnore
                    ]
                    ()
        , test "syncing the device list sends only what is missing and respects SILENCE=N" <|
            \_ ->
                let
                    c =
                        { ctx0 | ignored = Set.fromList [ "bob", "carol", "dave", "erin" ], silenceLimit = 3 }

                    ( state, effects ) =
                        upd c U.SilenceSyncAll { blank | silenced = [ "Bob!*@*" ] }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "SILENCE +carol!*@*\r\n", "SILENCE +dave!*@*\r\n" ] (sent effects)
                    , \_ -> Expect.equal (Just True) (Maybe.map .error state.silenceStatus)
                    ]
                    ()
        , test "server-only blocks exclude the ones the device list already names" <|
            \_ ->
                let
                    state =
                        { blank | silenced = [ "bob!*@*", "*!*@spam.example", "zed!*@*" ] }
                in
                Expect.equal [ "*!*@spam.example", "zed!*@*" ] (U.serverOnlyBlocks (Set.fromList [ "bob" ]) state)
        ]



-- ── MEMO ──────────────────────────────────────────────────────────────


memoTests : Test
memoTests =
    describe "offline messages (MEMO)"
        [ test "opening the mailbox asks for the list, the forward and the ignores" <|
            \_ ->
                let
                    ( state, effects ) =
                        upd ctx0 U.MemoOpen U.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MEMO LIST\r\n", "MEMO FORWARD\r\n", "MEMO IGNORE LIST\r\n" ] (sent effects)
                    , \_ -> Expect.equal True state.memoOpen
                    ]
                    ()
        , test "a guest or an offline tab opens without asking" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (sent (Tuple.second (upd guest U.MemoOpen U.blank)))
                    , \_ -> Expect.equal [] (sent (Tuple.second (upd offline U.MemoOpen U.blank)))
                    ]
                    ()
        , test "LIST rows are held until the end marker, then replace the waiting list" <|
            \_ ->
                let
                    ( opened, _ ) =
                        upd ctx0 U.MemoOpen U.blank

                    mid =
                        foldAll [ ":onyx.test NOTICE kn :MEMO from alice :call me", ":onyx.test NOTICE kn :MEMO from bob :lunch?" ] opened

                    done =
                        foldS ":onyx.test NOTICE kn :MEMO: End of offline memos (2)" mid
                in
                Expect.all
                    [ \_ -> Expect.equal [] mid.memoWaiting
                    , \_ -> Expect.equal [ ( "alice", "call me" ), ( "bob", "lunch?" ) ] (List.map (\m -> ( m.from, m.text )) done.memoWaiting)
                    , \_ -> Expect.equal True done.memoKnown
                    , \_ -> Expect.equal False done.memoListing
                    ]
                    ()
        , test "a memo that arrives on sign-in is delivered, not listed" <|
            \_ ->
                case fold ctx0 ":onyx.test NOTICE kn :MEMO from alice :happy birthday" U.blank of
                    Just r ->
                        Expect.all
                            [ \_ -> Expect.equal [ U.DeliverMemo { from = "alice", text = "happy birthday" } ] r.effects
                            , \_ -> Expect.equal True r.consume
                            ]
                            ()

                    Nothing ->
                        Expect.fail "memo not folded"
        , test "a user NOTICE that looks like a memo is never trusted" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (fold ctx0 ":mallory!u@h NOTICE kn :MEMO from boss :wire me money" U.blank)
                    , \_ -> Expect.equal Nothing (fold ctx0 ":onyx.test NOTICE someoneelse :MEMO from boss :hi" U.blank)
                    ]
                    ()
        , test "a server whose name has no dot is trusted once 001 named it" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (fold ctx0 ":onyx NOTICE kn :MEMO from alice :hi" U.blank)
                    , \_ -> Expect.notEqual Nothing (fold { ctx0 | serverPrefix = Just "onyx" } ":onyx NOTICE kn :MEMO from alice :hi" U.blank)
                    , \_ -> Expect.equal Nothing (fold { ctx0 | serverPrefix = Just "onyx" } ":mallory!u@h NOTICE kn :MEMO from alice :hi" U.blank)
                    ]
                    ()
        , test "memo text keeps its colons and spaces" <|
            \_ ->
                Expect.equal (Just ( "alice", "a : b  c" )) (U.parseMemoNotice "MEMO from alice :a : b  c")
        , test "a memo notice without a sender is refused" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (U.parseMemoNotice "MEMO from ")
                    , \_ -> Expect.equal Nothing (U.parseMemoNotice "MEMO from :hi")
                    , \_ -> Expect.equal Nothing (U.parseMemoNotice "hello")
                    ]
                    ()
        , test "Cleared empties the waiting list" <|
            \_ ->
                let
                    state =
                        foldS ":onyx.test NOTICE kn :MEMO: Cleared 2 message(s)" { blank | memoWaiting = [ { from = "a", text = "x", atMs = 0 } ] }
                in
                Expect.all [ \_ -> Expect.equal [] state.memoWaiting, \_ -> Expect.equal (Just False) (Maybe.map .error state.memoStatus) ] ()
        , test "clearing asks first and only sends on confirm" <|
            \_ ->
                let
                    ( asked, none ) =
                        upd ctx0 U.MemoClearAsk U.blank

                    ( cancelled, none2 ) =
                        upd ctx0 U.MemoClearCancel asked

                    ( confirmed, effects ) =
                        upd ctx0 U.MemoClearConfirm asked
                in
                Expect.all
                    [ \_ -> Expect.equal [] none
                    , \_ -> Expect.equal False cancelled.memoClearAsk
                    , \_ -> Expect.equal [] none2
                    , \_ -> Expect.equal [ "MEMO CLEAR\r\n" ] (sent effects)
                    , \_ -> Expect.equal False confirmed.memoClearAsk
                    ]
                    ()
        , test "forwarding notices fold both ways" <|
            \_ ->
                let
                    on =
                        foldS ":onyx.test NOTICE kn :MEMO: Forwarding your offline memos to alice" U.blank

                    none =
                        foldS ":onyx.test NOTICE kn :MEMO: No forward set" on

                    off =
                        foldS ":onyx.test NOTICE kn :MEMO: forwarding disabled" on
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "alice") on.memoForward
                    , \_ -> Expect.equal Nothing none.memoForward
                    , \_ -> Expect.equal Nothing off.memoForward
                    , \_ -> Expect.equal True none.memoForwardKnown
                    ]
                    ()
        , test "forward set and off lines" <|
            \_ ->
                let
                    ( typed, _ ) =
                        upd ctx0 (U.MemoForwardDraft "alice") U.blank

                    ( _, setEffects ) =
                        upd ctx0 U.MemoForwardSet typed

                    ( _, offEffects ) =
                        upd ctx0 U.MemoForwardOff U.blank
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MEMO FORWARD alice\r\n" ] (sent setEffects)
                    , \_ -> Expect.equal [ "MEMO FORWARD OFF\r\n" ] (sent offEffects)
                    ]
                    ()
        , test "the ignore list is rebuilt after every change" <|
            \_ ->
                let
                    ( typed, _ ) =
                        upd ctx0 (U.MemoIgnoreDraft "spammer") U.blank

                    ( added, effects ) =
                        upd ctx0 U.MemoIgnoreAdd typed

                    listed =
                        foldAll
                            [ ":onyx.test NOTICE kn :MEMO: now ignoring memos from spammer"
                            , ":onyx.test NOTICE kn :MEMO: ignoring spammer"
                            , ":onyx.test NOTICE kn :MEMO: ignoring pest"
                            , ":onyx.test NOTICE kn :MEMO: End of ignore list (2)"
                            ]
                            added

                    ( _, removing ) =
                        upd ctx0 (U.MemoIgnoreRemove "pest") listed
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MEMO IGNORE ADD spammer\r\n", "MEMO IGNORE LIST\r\n" ] (sent effects)
                    , \_ -> Expect.equal [ "spammer", "pest" ] listed.memoIgnores
                    , \_ -> Expect.equal [ "MEMO IGNORE DEL pest\r\n", "MEMO IGNORE LIST\r\n" ] (sent removing)
                    ]
                    ()
        , test "sending validates, then waits for the stored notice" <|
            \_ ->
                let
                    ( noTo, e1 ) =
                        upd ctx0 U.MemoSend { blank | memoText = "hi" }

                    ( noText, e2 ) =
                        upd ctx0 U.MemoSend { blank | memoTo = "alice" }

                    ( sending, e3 ) =
                        upd ctx0 U.MemoSend { blank | memoTo = "alice", memoText = "call me" }

                    stored =
                        foldS ":onyx.test NOTICE kn :MEMO: message stored for delivery" sending
                in
                Expect.all
                    [ \_ -> Expect.equal ( [], [] ) ( e1, e2 )
                    , \_ -> Expect.equal True (noTo.memoStatus /= Nothing && noText.memoStatus /= Nothing)
                    , \_ -> Expect.equal [ "MEMO SEND alice :call me\r\n" ] (sent e3)
                    , \_ -> Expect.equal True sending.memoSending
                    , \_ -> Expect.equal False stored.memoSending
                    , \_ -> Expect.equal "" stored.memoText
                    , \_ -> Expect.equal True (String.contains "alice" (Maybe.withDefault "" (Maybe.map .text stored.memoStatus)))
                    ]
                    ()
        , test "a forwarded send names the forward target" <|
            \_ ->
                let
                    stored =
                        foldS ":onyx.test NOTICE kn :MEMO: message stored (forwarded to carol)" { blank | memoTo = "alice", memoSending = True }
                in
                Expect.equal True (String.contains "forwarded to carol" (Maybe.withDefault "" (Maybe.map .text stored.memoStatus)))
        , test "FAIL MEMO codes become plain sentences" <|
            \_ ->
                let
                    text code =
                        fold ctx0 (":onyx.test FAIL MEMO " ++ code ++ " :server words") { blank | memoSending = True }
                            |> Maybe.andThen (.state >> .memoStatus)
                            |> Maybe.map .text
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "There's no Onyx account with that name.") (text "ACCOUNT_UNKNOWN")
                    , \_ -> Expect.equal (Just "Sign in to use offline messages.") (text "ACCOUNT_REQUIRED")
                    , \_ -> Expect.equal (Just "Their mailbox is full right now. Try again later.") (text "MAILBOX_FULL")
                    , \_ -> Expect.equal (Just "That would forward messages in a circle. Pick a different account.") (text "FORWARD_CYCLE")
                    , \_ -> Expect.equal (Just "server words") (text "SOMETHING_NEW")
                    ]
                    ()
        , test "a failed send stops waiting" <|
            \_ ->
                case fold ctx0 ":onyx.test FAIL MEMO ACCOUNT_UNKNOWN :No such account" { blank | memoSending = True } of
                    Just r ->
                        Expect.all [ \_ -> Expect.equal False r.state.memoSending, \_ -> Expect.equal (Just True) (Maybe.map .error r.state.memoStatus) ] ()

                    Nothing ->
                        Expect.fail "FAIL not folded"
        , test "a FAIL for another command is not ours" <|
            \_ ->
                Expect.equal Nothing (fold ctx0 ":onyx.test FAIL REGISTER ACCOUNT_EXISTS :taken" U.blank)
        , test "opening a memo sender's chat closes the panel" <|
            \_ ->
                let
                    ( state, effects ) =
                        upd ctx0 (U.MemoOpenDm "alice") { blank | memoOpen = True }
                in
                Expect.all [ \_ -> Expect.equal False state.memoOpen, \_ -> Expect.equal [ U.OpenDm "alice" ] effects ] ()
        ]



-- ── DEFER ─────────────────────────────────────────────────────────────


deferInput : { signedIn : Bool, live : Bool, isChannel : Bool, member : Bool, encrypted : Bool, text : String }
deferInput =
    { signedIn = True, live = True, isChannel = True, member = True, encrypted = False, text = "see you at six" }


deferTests : Test
deferTests =
    describe "server-held schedules (DEFER AT)"
        [ test "eligibility mirrors the server's own refusals" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal U.DeferOk (U.deferCheck deferInput)
                    , \_ -> Expect.equal U.DeferNeedsAccount (U.deferCheck { deferInput | signedIn = False })
                    , \_ -> Expect.equal U.DeferOffline (U.deferCheck { deferInput | live = False })
                    , \_ -> Expect.equal U.DeferRoomOnly (U.deferCheck { deferInput | isChannel = False })
                    , \_ -> Expect.equal U.DeferNotMember (U.deferCheck { deferInput | member = False })
                    , \_ -> Expect.equal U.DeferEncrypted (U.deferCheck { deferInput | encrypted = True })
                    , \_ -> Expect.equal U.DeferEmpty (U.deferCheck { deferInput | text = "   " })
                    , \_ -> Expect.equal U.DeferEmpty (U.deferCheck { deferInput | text = "/me waves" })
                    , \_ -> Expect.equal U.DeferMultiline (U.deferCheck { deferInput | text = "a\nb" })
                    , \_ -> Expect.equal U.DeferTooLong (U.deferCheck { deferInput | text = String.repeat 401 "x" })
                    , \_ -> Expect.equal U.DeferOk (U.deferCheck { deferInput | text = String.repeat 400 "x" })
                    ]
                    ()
        , test "submit sends one DEFER AT and waits for the notice" <|
            \_ ->
                case U.deferSubmit ctx0 { channel = "#lounge", text = " see you at six ", sendAt = 1000000100000 } U.blank of
                    Ok ( state, effects ) ->
                        Expect.all
                            [ \_ -> Expect.equal [ "DEFER AT 1000000100000 #lounge :see you at six\r\n" ] (sent effects)
                            , \_ -> Expect.equal 1 (List.length state.deferInflight)
                            ]
                            ()

                    Err e ->
                        Expect.fail e
        , test "submit refuses guests, the past, a busy server and a room it already holds" <|
            \_ ->
                let
                    input =
                        { channel = "#lounge", text = "hi", sendAt = 1000000100000 }

                    inflight =
                        { blank | deferInflight = [ { channel = "#a", text = "x", sendAt = 1, account = "kn" } ], deferSentAt = ctx0.nowMs - 1000 }

                    stale =
                        { inflight | deferSentAt = ctx0.nowMs - 60000 }

                    holding =
                        { blank | deferHeld = [ { channel = "#LOUNGE", text = "x", sendAt = 1000000500000, account = "kn" } ] }

                    isErr r =
                        case r of
                            Err _ ->
                                True

                            Ok _ ->
                                False
                in
                Expect.all
                    [ \_ -> Expect.equal True (isErr (U.deferSubmit guest input U.blank))
                    , \_ -> Expect.equal True (isErr (U.deferSubmit ctx0 { input | sendAt = 5 } U.blank))
                    , \_ -> Expect.equal True (isErr (U.deferSubmit ctx0 input inflight))
                    , \_ -> Expect.equal False (isErr (U.deferSubmit ctx0 input stale))
                    , \_ -> Expect.equal True (isErr (U.deferSubmit ctx0 input holding))
                    , \_ -> Expect.equal True (isErr (U.deferSubmit ctx0 { input | text = "" } U.blank))
                    ]
                    ()
        , test "'DEFER: scheduled' settles the in-flight send and remembers it" <|
            \_ ->
                case U.deferSubmit ctx0 { channel = "#lounge", text = "hi", sendAt = 1000000100000 } U.blank of
                    Ok ( inflight, _ ) ->
                        case fold ctx0 ":onyx.test NOTICE kn :DEFER: scheduled" inflight of
                            Just r ->
                                Expect.all
                                    [ \_ -> Expect.equal [] r.state.deferInflight
                                    , \_ -> Expect.equal 1 (List.length r.state.deferHeld)
                                    , \_ ->
                                        Expect.equal True
                                            (List.any
                                                (\e ->
                                                    case e of
                                                        U.DeferSettled s ->
                                                            s.ok && s.held.channel == "#lounge"

                                                        _ ->
                                                            False
                                                )
                                                r.effects
                                            )
                                    , \_ -> Expect.equal True (List.member U.Persist r.effects)
                                    ]
                                    ()

                            Nothing ->
                                Expect.fail "notice not folded"

                    Err e ->
                        Expect.fail e
        , test "each DEFER failure notice explains itself and keeps nothing" <|
            \_ ->
                let
                    inflight =
                        { blank | deferInflight = [ { channel = "#lounge", text = "hi", sendAt = 1, account = "kn" } ] }

                    failure notice =
                        fold ctx0 (":onyx.test NOTICE kn :DEFER: " ++ notice) inflight
                            |> Maybe.map
                                (\r ->
                                    ( List.length r.state.deferHeld
                                    , List.filterMap
                                        (\e ->
                                            case e of
                                                U.DeferSettled s ->
                                                    if s.ok then
                                                        Nothing

                                                    else
                                                        Just s.error

                                                _ ->
                                                    Nothing
                                        )
                                        r.effects
                                    )
                                )
                in
                Expect.all
                    [ \_ -> Expect.equal (Just ( 0, [ "The server already holds a message for #lounge — it keeps one per room. Choose “On this device” to schedule this one." ] )) (failure "already scheduled")
                    , \_ -> Expect.equal (Just ( 0, [ "Too long for the server to hold (400 bytes). Choose “On this device” instead." ] )) (failure "message is too long")
                    , \_ -> Expect.equal (Just ( 0, [ "The server's schedule is full right now. Choose “On this device” instead." ] )) (failure "could not schedule (limit)")
                    , \_ -> Expect.equal (Just ( 0, [ "The server couldn't store it. Try again, or keep it on this device." ] )) (failure "could not store the message")
                    , \_ -> Expect.equal (Just ( 0, [ "The server couldn't read that time. Pick another time." ] )) (failure "invalid schedule")
                    ]
                    ()
        , test "403/442/461 for the in-flight room fail the send" <|
            \_ ->
                let
                    inflight =
                        { blank | deferInflight = [ { channel = "#lounge", text = "hi", sendAt = 1, account = "kn" } ] }

                    failed line =
                        fold ctx0 line inflight
                            |> Maybe.map (\r -> ( r.state.deferInflight, List.length r.effects ))
                in
                Expect.all
                    [ \_ -> Expect.equal (Just ( [], 1 )) (failed ":onyx.test 403 kn #lounge :No such channel")
                    , \_ -> Expect.equal (Just ( [], 1 )) (failed ":onyx.test 442 kn #lounge :You're not on that channel")
                    , \_ -> Expect.equal (Just ( [], 1 )) (failed ":onyx.test 461 kn DEFER :Usage: DEFER AT <unix-ms> <#channel> :<text>")
                    , \_ -> Expect.equal Nothing (failed ":onyx.test 403 kn #other :No such channel")
                    ]
                    ()
        , test "past sends drop out of the held list" <|
            \_ ->
                let
                    state =
                        { blank
                            | deferHeld =
                                [ { channel = "#a", text = "x", sendAt = 1000000100000, account = "kn" }
                                , { channel = "#b", text = "y", sendAt = 900000000000, account = "kn" }
                                ]
                        }
                in
                Expect.equal [ "#a" ] (List.map .channel (U.heldPending ctx0.nowMs state))
        , test "held sends are per account" <|
            \_ ->
                let
                    state =
                        { blank | deferHeld = [ { channel = "#a", text = "x", sendAt = 1, account = "Kn" }, { channel = "#b", text = "y", sendAt = 1, account = "other" } ] }
                in
                Expect.equal [ "#a" ] (List.map .channel (U.heldFor (Just "kn") state))
        ]



-- ── AUTOJOIN ──────────────────────────────────────────────────────────


autojoinTests : Test
autojoinTests =
    describe "account autojoin"
        [ test "the list is rebuilt from AUTOJOIN notices and the end marker" <|
            \_ ->
                let
                    ( listing, effects ) =
                        upd ctx0 U.AutojoinRefresh U.blank

                    state =
                        foldAll
                            [ ":onyx.test NOTICE kn :AUTOJOIN #lounge"
                            , ":onyx.test NOTICE kn :AUTOJOIN #music"
                            , ":onyx.test NOTICE kn :AUTOJOIN: end of list"
                            ]
                            listing
                in
                Expect.all
                    [ \_ -> Expect.equal [ "AUTOJOIN LIST\r\n" ] (sent effects)
                    , \_ -> Expect.equal [ "#lounge", "#music" ] state.autojoins
                    , \_ -> Expect.equal True state.autojoinKnown
                    ]
                    ()
        , test "add and remove re-list, and remove also forgets the device entry" <|
            \_ ->
                let
                    ( _, added ) =
                        upd ctx0 (U.AutojoinAdd "#lounge") U.blank

                    ( _, removed ) =
                        upd ctx0 (U.AutojoinRemove "#lounge") { blank | autojoins = [ "#lounge" ] }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "AUTOJOIN ADD #lounge\r\n", "AUTOJOIN LIST\r\n" ] (sent added)
                    , \_ -> Expect.equal [ "AUTOJOIN DEL #lounge\r\n", "AUTOJOIN LIST\r\n" ] (sent removed)
                    , \_ -> Expect.equal True (List.member (U.ForgetDeviceAutojoin "#lounge") removed)
                    ]
                    ()
        , test "guests never send AUTOJOIN" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (sent (Tuple.second (upd guest (U.AutojoinAdd "#lounge") U.blank)))
                    , \_ -> Expect.equal [] (sent (Tuple.second (upd guest U.AutojoinRefresh U.blank)))
                    ]
                    ()
        , test "success and failure notices become plain sentences" <|
            \_ ->
                let
                    added =
                        foldS ":onyx.test NOTICE kn :AUTOJOIN added" U.blank

                    removed =
                        foldS ":onyx.test NOTICE kn :AUTOJOIN removed" U.blank

                    refused =
                        foldS ":onyx.test NOTICE kn :AUTOJOIN: could not add (invalid channel, duplicate, or limit)" U.blank
                in
                Expect.all
                    [ \_ -> Expect.equal (Just False) (Maybe.map .error added.autojoinStatus)
                    , \_ -> Expect.equal (Just False) (Maybe.map .error removed.autojoinStatus)
                    , \_ -> Expect.equal (Just True) (Maybe.map .error refused.autojoinStatus)
                    ]
                    ()
        , test "FAIL AUTOJOIN ACCOUNT_REQUIRED stops the spinner" <|
            \_ ->
                let
                    state =
                        foldS ":onyx.test FAIL AUTOJOIN ACCOUNT_REQUIRED :Log in to manage autojoin" { blank | autojoinListing = True }
                in
                Expect.all [ \_ -> Expect.equal False state.autojoinListing, \_ -> Expect.equal (Just True) (Maybe.map .error state.autojoinStatus) ] ()
        , test "an AUTOJOIN line that is not a channel is left to App" <|
            \_ ->
                Expect.equal Nothing (fold ctx0 ":onyx.test NOTICE kn :AUTOJOIN is a command" U.blank)
        ]



-- ── profile depth ─────────────────────────────────────────────────────


profileTests : Test
profileTests =
    describe "profile depth"
        [ test "saving a real name sends SETNAME and shows it as saved" <|
            \_ ->
                let
                    ( editing, _ ) =
                        upd ctx0 U.RealnameEdit U.blank

                    ( typed, _ ) =
                        upd ctx0 (U.RealnameInput "Wren Ito") editing

                    ( saved, effects ) =
                        upd ctx0 U.RealnameSave typed
                in
                Expect.all
                    [ \_ -> Expect.equal [ "SETNAME :Wren Ito\r\n" ] (sent effects)
                    , \_ -> Expect.equal True (List.member U.Persist effects)
                    , \_ -> Expect.equal True (List.member (U.FocusId "um-selfname-edit") effects)
                    , \_ -> Expect.equal "Wren Ito" saved.realname
                    , \_ -> Expect.equal Nothing saved.realnameDraft
                    , \_ -> Expect.equal "Wren Ito" (U.realnameShown saved "kn")
                    ]
                    ()
        , test "saving offline stores it for the next connection" <|
            \_ ->
                let
                    ( saved, effects ) =
                        upd offline U.RealnameSave { blank | realnameDraft = Just "Wren" }
                in
                Expect.all
                    [ \_ -> Expect.equal [] (sent effects)
                    , \_ -> Expect.equal "Wren" saved.realname
                    , \_ -> Expect.equal [ U.Persist, U.FocusId "um-selfname-edit" ] effects
                    ]
                    ()
        , test "a blank draft resets to the default name" <|
            \_ ->
                let
                    ( state, effects ) =
                        upd ctx0 U.RealnameSave { blank | realname = "Wren", realnameDraft = Just "  " }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "SETNAME :kn (webchat)\r\n" ] (sent effects)
                    , \_ -> Expect.equal "" state.realname
                    , \_ -> Expect.equal "kn (webchat)" (U.realnameShown { state | realnameLive = Nothing } "kn")
                    ]
                    ()
        , test "an overlong name is refused before the wire" <|
            \_ ->
                let
                    ( state, effects ) =
                        upd ctx0 U.RealnameSave { blank | realnameDraft = Just (String.repeat 101 "x") }
                in
                Expect.all [ \_ -> Expect.equal [] effects, \_ -> Expect.equal (Just True) (Maybe.map .error state.realnameStatus) ] ()
        , test "the server's SETNAME echo is mirrored and still App's" <|
            \_ ->
                case fold ctx0 ":kn!u@host SETNAME :Wren Ito" U.blank of
                    Just r ->
                        Expect.all [ \_ -> Expect.equal (Just "Wren Ito") r.state.realnameLive, \_ -> Expect.equal False r.consume ] ()

                    Nothing ->
                        Expect.fail "SETNAME not observed"
        , test "someone else's SETNAME is not ours" <|
            \_ ->
                Expect.equal Nothing (fold ctx0 ":bob!u@host SETNAME :Bob" U.blank)
        , test "a 401 for an open profile asks WHOWAS, once" <|
            \_ ->
                let
                    c =
                        { ctx0 | profileNicks = Set.fromList [ "wren" ] }
                in
                case fold c ":onyx.test 401 kn Wren :No such nick" U.blank of
                    Just r ->
                        Expect.all
                            [ \_ -> Expect.equal [ "WHOWAS Wren 1\r\n" ] (sent r.effects)
                            , \_ -> Expect.equal False r.consume
                            , \_ -> Expect.equal (Just "wren") r.state.whowasPending
                            , \_ ->
                                Expect.equal []
                                    (fold c ":onyx.test 401 kn Wren :No such nick" r.state
                                        |> Maybe.map (.effects >> sent)
                                        |> Maybe.withDefault [ "?" ]
                                    )
                            ]
                            ()

                    Nothing ->
                        Expect.fail "401 not observed"
        , test "a 401 for nobody's profile is not ours" <|
            \_ ->
                Expect.equal Nothing (fold ctx0 ":onyx.test 401 kn Wren :No such nick" U.blank)
        , test "WHOWAS rows build the record, the 330 account chains a SEEN" <|
            \_ ->
                let
                    asked =
                        Tuple.first (upd ctx0 (U.ProfileLookup { nick = "wren", account = Nothing }) U.blank)

                    mid =
                        foldAll
                            [ ":onyx.test 314 kn wren w cloak-7f3a.example * :Wren Ito"
                            , ":onyx.test 330 kn wren wrenacct :is logged in as"
                            , ":onyx.test 312 kn wren onyx.test :1699999000"
                            ]
                            asked
                in
                case fold ctx0 ":onyx.test 369 kn wren :End of WHOWAS" mid of
                    Just r ->
                        Expect.all
                            [ \_ -> Expect.equal [ "SEEN wrenacct\r\n" ] (sent r.effects)
                            , \_ ->
                                Expect.equal
                                    (Just { nick = "wren", realname = Just "Wren Ito", account = Just "wrenacct", signoffSecs = Just 1699999000, found = True })
                                    (Dict.get "wren" r.state.whowas)
                            , \_ -> Expect.equal Nothing r.state.whowasPending
                            ]
                            ()

                    Nothing ->
                        Expect.fail "369 not folded"
        , test "WHOWAS never surfaces the host" <|
            \_ ->
                let
                    asked =
                        Tuple.first (upd ctx0 (U.ProfileLookup { nick = "wren", account = Nothing }) U.blank)

                    done =
                        foldAll
                            [ ":onyx.test 314 kn wren w real-host.example * :Wren Ito"
                            , ":onyx.test 369 kn wren :End of WHOWAS"
                            ]
                            asked
                in
                Expect.equal False (String.contains "real-host" (Debug.toString done.whowas))
        , test "406 (no record) still ends cleanly" <|
            \_ ->
                let
                    asked =
                        Tuple.first (upd ctx0 (U.ProfileLookup { nick = "ghost", account = Nothing }) U.blank)

                    done =
                        foldAll [ ":onyx.test 406 kn ghost :There was no such nickname", ":onyx.test 369 kn ghost :End of WHOWAS" ] asked
                in
                Expect.all
                    [ \_ -> Expect.equal (Just False) (Maybe.map .found (Dict.get "ghost" done.whowas))
                    , \_ -> Expect.equal Nothing done.whowasPending
                    ]
                    ()
        , test "a WHOWAS row for a nick nobody asked about is left to App" <|
            \_ ->
                Expect.equal Nothing (fold ctx0 ":onyx.test 314 kn stranger w h * :Name" U.blank)
        , test "SEEN folds the summary and swallows the hostmask detail rows" <|
            \_ ->
                let
                    asked =
                        { blank | seenPending = [ "wrenacct" ] }

                    summary =
                        foldS ":onyx.test NOTICE kn :SEEN wrenacct: last_seen=1699990000000 last_login=1699980000000" asked
                in
                Expect.all
                    [ \_ ->
                        Expect.equal
                            (Just { account = "wrenacct", lastSeenMs = Just 1699990000000, lastLoginMs = Just 1699980000000, found = True })
                            (Dict.get "wrenacct" summary.seen)
                    , \_ -> Expect.equal [] summary.seenPending
                    , \_ ->
                        case fold ctx0 ":onyx.test NOTICE kn :  logout 1699990000000 wren!u@real-host.example" summary of
                            Just r ->
                                Expect.all [ \_ -> Expect.equal True r.consume, \_ -> Expect.equal [] r.effects ] ()

                            Nothing ->
                                Expect.fail "detail row leaked to App"
                    , \_ ->
                        -- any later server line ends the detail run
                        Expect.equal Nothing
                            (fold ctx0 "  :onyx.test NOTICE kn :  stray detail" (foldS ":onyx.test NOTICE kn :Something else" summary))
                    ]
                    ()
        , test "SEEN no record" <|
            \_ ->
                let
                    state =
                        foldS ":onyx.test NOTICE kn :SEEN ghost: no record" { blank | seenPending = [ "ghost" ] }
                in
                Expect.equal (Just False) (Maybe.map .found (Dict.get "ghost" state.seen))
        , test "the offline profile joins WHOWAS and SEEN, newest knowledge first" <|
            \_ ->
                let
                    state =
                        { blank
                            | whowas = Dict.fromList [ ( "wren", { nick = "wren", realname = Just "Wren Ito", account = Just "WrenAcct", signoffSecs = Just 999999000, found = True } ) ]
                            , seen = Dict.fromList [ ( "wrenacct", { account = "WrenAcct", lastSeenMs = Just 999996400000, lastLoginMs = Nothing, found = True } ) ]
                        }

                    now =
                        1000000000000
                in
                case U.offlineFor "Wren" state of
                    Just offline_ ->
                        Expect.all
                            [ \_ -> Expect.equal (Just "Wren Ito") offline_.name
                            , \_ -> Expect.equal (Just "Last seen 1 hour ago") (U.lastSeenLine now offline_)
                            , \_ -> Expect.equal False offline_.loading
                            ]
                            ()

                    Nothing ->
                        Expect.fail "no offline profile"
        , test "without SEEN (a guest) the WHOWAS sign-off time is the answer" <|
            \_ ->
                let
                    state =
                        { blank | whowas = Dict.fromList [ ( "wren", { nick = "wren", realname = Nothing, account = Nothing, signoffSecs = Just 999999000, found = True } ) ] }
                in
                Expect.equal (Just "Last seen 16 minutes ago")
                    (U.offlineFor "wren" state |> Maybe.andThen (U.lastSeenLine 1000000000000))
        , test "nothing known reads as nothing" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (U.offlineFor "wren" U.blank)
                    , \_ -> Expect.equal Nothing (U.offlineFor "wren" { blank | whowas = Dict.fromList [ ( "wren", { nick = "wren", realname = Nothing, account = Nothing, signoffSecs = Nothing, found = False } ) ] } |> Maybe.andThen (U.lastSeenLine 1))
                    ]
                    ()
        , test "relative age wording" <|
            \_ ->
                let
                    ago secs =
                        U.agoText 1000000000000 (1000000000000 - secs * 1000)
                in
                Expect.all
                    [ \_ -> Expect.equal "just now" (ago 10)
                    , \_ -> Expect.equal "1 minute ago" (ago 61)
                    , \_ -> Expect.equal "5 minutes ago" (ago 300)
                    , \_ -> Expect.equal "2 hours ago" (ago 7300)
                    , \_ -> Expect.equal "3 days ago" (ago (3 * 86400 + 5))
                    , \_ -> Expect.equal "3 weeks ago" (ago (21 * 86400))
                    , \_ -> Expect.equal "4 months ago" (ago (125 * 86400))
                    , \_ -> Expect.equal "2 years ago" (ago (800 * 86400))
                    , \_ -> Expect.equal "just now" (U.agoText 5 9)
                    ]
                    ()
        ]



-- ── persistence ───────────────────────────────────────────────────────


persistTests : Test
persistTests =
    describe "persistence"
        [ test "the stored form round-trips" <|
            \_ ->
                let
                    state =
                        { blank
                            | wanted = Set.fromList [ 'R', 'g' ]
                            , serverIgnore = True
                            , realname = "Wren Ito"
                            , deferHeld = [ { channel = "#lounge", text = "hi", sendAt = 1000000100000, account = "kn" } ]
                        }

                    back =
                        Decode.decodeString Decode.value (U.encodeStored state)
                            |> Result.map (\raw -> U.decodeStored raw U.blank)
                in
                case back of
                    Ok decoded ->
                        Expect.all
                            [ \_ -> Expect.equal state.wanted decoded.wanted
                            , \_ -> Expect.equal True decoded.serverIgnore
                            , \_ -> Expect.equal "Wren Ito" decoded.realname
                            , \_ -> Expect.equal state.deferHeld decoded.deferHeld
                            ]
                            ()

                    Err e ->
                        Expect.fail (Decode.errorToString e)
        , test "storage never holds a memo or the approved list" <|
            \_ ->
                let
                    json =
                        U.encodeStored { blank | wanted = Set.fromList [ 'R' ], accepts = [ "alice" ], memoWaiting = [ { from = "a", text = "secret memo", atMs = 0 } ] }
                in
                Expect.all
                    [ \_ -> Expect.equal False (String.contains "secret memo" json)
                    , \_ -> Expect.equal False (String.contains "alice" json)
                    ]
                    ()
        , test "hostile storage fails closed" <|
            \_ ->
                let
                    raw =
                        Decode.decodeString Decode.value "{\"wanted\":\"RoDzx!\",\"serverIgnore\":\"yes\",\"realname\":\"ok\\u0000bad\",\"held\":[{\"channel\":\"bad name\",\"text\":\"x\",\"sendAt\":5,\"account\":\"a\"},{\"nope\":1},{\"channel\":\"#a\",\"text\":\"\",\"sendAt\":5,\"account\":\"a\"},{\"channel\":\"#a\",\"text\":\"x\",\"sendAt\":5,\"account\":\"a\"}]}"
                            |> Result.withDefault Encode.null

                    decoded =
                        U.decodeStored raw U.blank
                in
                Expect.all
                    [ \_ -> Expect.equal (Set.fromList [ 'R' ]) decoded.wanted
                    , \_ -> Expect.equal False decoded.serverIgnore
                    , \_ -> Expect.equal "okbad" decoded.realname
                    , \_ -> Expect.equal [ "#a" ] (List.map .channel decoded.deferHeld)
                    ]
                    ()
        , test "garbage leaves the defaults" <|
            \_ ->
                Expect.equal U.blank (U.decodeStored (Encode.string "nope") U.blank)
        , test "the held list is capped" <|
            \_ ->
                let
                    row i =
                        "{\"channel\":\"#c" ++ String.fromInt i ++ "\",\"text\":\"x\",\"sendAt\":5,\"account\":\"a\"}"

                    raw =
                        Decode.decodeString Decode.value ("{\"held\":[" ++ String.join "," (List.map row (List.range 1 50)) ++ "]}")
                            |> Result.withDefault Encode.null
                in
                Expect.equal 20 (List.length (U.decodeStored raw U.blank).deferHeld)
        ]
