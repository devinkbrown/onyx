module GapCommandsTest exposing (suite)

{-| v3/gap-commands vectors.

  - Slash verbs Onyx Server has no wire verb for (`ME`, `MSG`, `J`,
    `OP`, `BAN`, `BACK`, `QUOTE`, `CTCP`, `STAGE`, `SHARE`… answer 421)
    are translated; the room verbs fill in the open room.
  - SECURITY: every translated verb that carries user content (`/me`,
    `/msg`, `/query`, `/notice`, CTCP ACTION) rides the composer path:
    designated DMs and required-encryption rooms seal, unresolved peers
    hold — no plaintext ever reaches the wire.
  - Inbound CTCP ACTION files an action row (live, DM, history replay,
    echoes, sealed opens) instead of vanishing.
  - `/help` lists exactly the verbs that work.
  - The palette's People rows, recents, action rows and query grammar;
    the shell chords; the views.

-}

import App exposing (..)
import Base64Url
import Dict
import DmSafety
import Expect
import Html
import Html.Attributes
import InviteShare
import Json.Encode as Encode
import Nav
import Prefs
import Route
import Set
import Sidebar
import Switcher
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Transcript
import TranscriptRows
import View
import Wire


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


send : String -> Model -> ( Model, List Outbound )
send text model =
    update ComposerSend { model | composer = text }


wire : List Outbound -> List String
wire =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    Just line

                _ ->
                    Nothing
        )


carries : String -> List Outbound -> Bool
carries needle outs =
    List.any (String.contains needle) (wire outs)


seals : List Outbound -> List { target : String, plaintext : String }
seals =
    List.filterMap
        (\o ->
            case o of
                DmSealRequested req ->
                    Just { target = req.target, plaintext = req.plaintext }

                _ ->
                    Nothing
        )


roomSeals : List Outbound -> List { room : String, plaintext : String }
roomSeals =
    List.filterMap
        (\o ->
            case o of
                RoomSealRequested req ->
                    Just req

                _ ->
                    Nothing
        )


peerKey : String
peerKey =
    Base64Url.encode (0x04 :: List.repeat 64 7)


{-| Live, with a device-memory owner (endpoint + nick), nick `kai`, in
#c with alice and bob; #c open. -}
room : Model
room =
    { blank | endpoint = Just "wss://onyx.example/ws", ourNick = "kai", nowMs = 1000, origin = "https://eshmaki.me" }
        |> (\m -> feed m ":kai!u@h JOIN #c")
        |> (\m -> feed m ":alice!u@h JOIN #c")
        |> (\m -> feed m ":bob!u@h JOIN #c")
        |> step (ChannelSelect "#c")


{-| `room` where bob has published a DM key (designated: DMs seal). -}
designated : Model
designated =
    feed room (":s 761 kai bob ocean.dm-key pub :" ++ peerKey)


{-| Chat rows of one bucket (system join lines left out). -}
rows : Model -> String -> List ChatMessage
rows model bucket =
    Maybe.withDefault [] (Maybe.map .messages (Dict.get (String.toLower bucket) model.channels))
        |> List.filter (\m -> not (TranscriptRows.isSystemType m.msgType))


toastTitles : Model -> List String
toastTitles model =
    List.map .title model.toasts


toastDescriptions : Model -> List String
toastDescriptions model =
    List.filterMap .description model.toasts


paletteTitles : Model -> List String
paletteTitles model =
    List.map (.entry >> .title) (paletteMatches model)


openPalette : Model -> Model
openPalette model =
    step (ShortcutPressed Switcher.TogglePalette) model


runTitle : String -> Model -> ( Model, List Outbound )
runTitle title model =
    let
        index =
            paletteMatches model
                |> List.indexedMap Tuple.pair
                |> List.filter (\( _, m ) -> m.entry.title == title)
                |> List.head
                |> Maybe.map Tuple.first
                |> Maybe.withDefault -1
    in
    update (PaletteRun index) model


chord : Switcher.AppChord -> Model -> ( Model, List Outbound )
chord c model =
    update (ShortcutPressed (Switcher.AppChord c)) model


html : Model -> Query.Single Msg
html model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


attr : String -> String -> Selector.Selector
attr name value =
    Selector.attribute (Html.Attributes.attribute name value)


suite : Test
suite =
    describe "v3/gap-commands"
        [ securitySuite
        , translationSuite
        , actionSuite
        , helpSuite
        , paletteSuite
        , chordSuite
        , viewSuite
        ]



-- SECURITY: content verbs never leak plaintext


securitySuite : Test
securitySuite =
    describe "content verbs ride the composer protection"
        [ test "/me in a designated DM seals the ACTION, no plaintext PRIVMSG" <|
            \_ ->
                let
                    ( _, outs ) =
                        send "/me waves" (step (ChannelSelect "bob") designated)
                in
                Expect.all
                    [ \_ -> Expect.equal [ { target = "bob", plaintext = "\u{0001}ACTION waves\u{0001}" } ] (seals outs)
                    , \_ -> Expect.equal False (carries "waves" outs)
                    , \_ -> Expect.equal False (carries "ACTION" outs)
                    ]
                    ()
        , test "/msg to a designated DM opens it and seals, no plaintext PRIVMSG" <|
            \_ ->
                let
                    ( sent, outs ) =
                        send "/msg bob secret plans" designated
                in
                Expect.all
                    [ \_ -> Expect.equal [ { target = "bob", plaintext = "secret plans" } ] (seals outs)
                    , \_ -> Expect.equal False (carries "secret" outs)
                    , \_ -> Expect.equal (Just "bob") sent.activeChannel
                    , \_ -> Expect.equal "" (Maybe.withDefault "" (Dict.get "#c" sent.composerDrafts))
                    ]
                    ()
        , test "/query with text seals the same way" <|
            \_ ->
                let
                    ( _, outs ) =
                        send "/query bob hello" designated
                in
                Expect.equal ( [ { target = "bob", plaintext = "hello" } ], False ) ( seals outs, carries "hello" outs )
        , test "/me to an unresolved peer holds: no PRIVMSG, command kept, consent offered" <|
            \_ ->
                let
                    ( held, outs ) =
                        send "/me waves" (step (ChannelSelect "dave") room)
                in
                Expect.all
                    [ \_ -> Expect.equal False (carries "PRIVMSG" outs)
                    , \_ -> Expect.equal [] (seals outs)
                    , \_ -> Expect.equal "/me waves" held.composer
                    , \_ -> Expect.equal (Just "dave") held.dmKeyHold
                    , \_ -> Expect.equal (Just (holdDmCopy "dave")) held.composerError
                    ]
                    ()
        , test "explicit consent after a /me hold sends the action in the clear" <|
            \_ ->
                let
                    ( held, _ ) =
                        send "/me waves" (step (ChannelSelect "dave") room)

                    ( _, outs ) =
                        update (DmSendUnencrypted "dave") held
                in
                Expect.equal [ "PRIVMSG dave :\u{0001}ACTION waves\u{0001}\u{000D}\n" ] (List.filter (String.contains "PRIVMSG") (wire outs))
        , test "/msg to an unresolved peer opens the DM and holds there" <|
            \_ ->
                let
                    ( held, outs ) =
                        send "/msg dave hi there" room
                in
                Expect.all
                    [ \_ -> Expect.equal False (carries "hi there" outs)
                    , \_ -> Expect.equal (Just "dave") held.activeChannel
                    , \_ -> Expect.equal "hi there" held.composer
                    , \_ -> Expect.equal (Just "dave") held.dmKeyHold
                    ]
                    ()
        , test "/me in a required-encryption room seals the room envelope" <|
            \_ ->
                let
                    required =
                        feed room ":s 818 kai #c encryption-policy :required"

                    ( _, outs ) =
                        send "/me waves" required
                in
                Expect.all
                    [ \_ -> Expect.equal [ { room = "#c", plaintext = "\u{0001}ACTION waves\u{0001}" } ] (roomSeals outs)
                    , \_ -> Expect.equal False (carries "waves" outs)
                    ]
                    ()
        , test "/notice to a designated peer seals instead of sending a plaintext NOTICE" <|
            \_ ->
                let
                    ( _, outs ) =
                        send "/notice bob psst" designated
                in
                Expect.equal ( [ { target = "bob", plaintext = "psst" } ], False ) ( seals outs, carries "psst" outs )
        , test "a pending key change holds /me and /msg: nothing seals, nothing goes out" <|
            \_ ->
                let
                    changed =
                        { designated | peerKeyChanges = Set.singleton "bob" }

                    ( meHeld, meOut ) =
                        send "/me waves" (step (ChannelSelect "bob") changed)

                    ( msgHeld, msgOut ) =
                        send "/msg bob secret plans" changed

                    ( _, noticeOut ) =
                        send "/notice bob psst" changed

                    ( quoted, quoteOut ) =
                        send "/quote PRIVMSG bob :secret" changed
                in
                Expect.all
                    [ \_ -> Expect.equal [] (seals (meOut ++ msgOut ++ noticeOut))
                    , \_ -> Expect.equal [] (List.filter (\l -> String.contains "PRIVMSG" l || String.contains "NOTICE" l) (wire (meOut ++ msgOut ++ noticeOut ++ quoteOut)))
                    , \_ -> Expect.equal (Just (DmSafety.keyChangeHoldCopy "bob")) meHeld.composerError
                    , \_ -> Expect.equal (Just (DmSafety.keyChangeHoldCopy "bob")) msgHeld.composerError
                    , \_ -> Expect.equal (Just (rawSlashLeakCopy "bob")) quoted.composerError
                    ]
                    ()
        , test "/notice to an unresolved peer holds" <|
            \_ ->
                let
                    ( held, outs ) =
                        send "/notice dave psst" room
                in
                Expect.equal ( False, Just "dave", "/notice dave psst" ) ( carries "psst" outs, held.dmKeyHold, held.composer )
        , test "/ctcp ACTION to a designated peer seals and keeps the open room" <|
            \_ ->
                let
                    ( sent, outs ) =
                        send "/ctcp bob action dances" designated
                in
                Expect.equal ( [ { target = "bob", plaintext = "\u{0001}ACTION dances\u{0001}" } ], False, Just "#c" )
                    ( seals outs, carries "dances" outs, sent.activeChannel )
        , test "/ctcp with arguments to a protected peer is refused" <|
            \_ ->
                let
                    ( refused, outs ) =
                        send "/ctcp bob PING secret" designated
                in
                Expect.equal ( [], Just (rawSlashLeakCopy "bob") ) ( wire outs, refused.composerError )
        , test "/quote and /raw content verbs to protected targets are refused, comma lists included" <|
            \_ ->
                let
                    ( one, oneOut ) =
                        send "/quote PRIVMSG bob :secret" designated

                    ( _, listOut ) =
                        send "/raw PRIVMSG carol,bob :secret" designated

                    ( _, noticeOut ) =
                        send "/quote NOTICE dave :secret" room
                in
                Expect.all
                    [ \_ -> Expect.equal [] (wire oneOut ++ wire listOut ++ wire noticeOut)
                    , \_ -> Expect.equal (Just (rawSlashLeakCopy "bob")) one.composerError
                    , \_ -> Expect.equal "/quote PRIVMSG bob :secret" one.composer
                    ]
                    ()
        , test "MEMO SEND is a content verb too: its account is guarded like a destination" <|
            \_ ->
                let
                    ( held, memoOut ) =
                        send "/memo send bob secret" designated

                    ( _, quoteOut ) =
                        send "/quote MEMO SEND bob :secret" designated

                    ( _, listOut ) =
                        send "/memo list" designated
                in
                Expect.all
                    [ \_ -> Expect.equal [] (wire memoOut ++ wire quoteOut)
                    , \_ -> Expect.equal (Just (rawSlashLeakCopy "bob")) held.composerError
                    , \_ -> Expect.equal [ "MEMO list\u{000D}\n" ] (wire listOut)
                    , \_ -> Expect.equal ( Just "bob", Nothing, Nothing ) ( rawContentDestination "MEMO" [ "SEND", "bob", "x" ], rawContentDestination "MEMO" [ "LIST" ], rawContentDestination "WHOIS" [ "bob" ] )
                    ]
                    ()
        , test "the raw fallthrough is comma-list aware too" <|
            \_ ->
                Expect.equal [] (wire (Tuple.second (send "/privmsg carol,bob secret" designated)))
        , test "destinationsLeak is fail-closed across every listed target" <|
            \_ ->
                Expect.equal [ True, True, False ]
                    [ destinationsLeak designated "bob"
                    , destinationsLeak designated "#c,bob"
                    , destinationsLeak { room | dmKeyAnswered = Set.singleton "carol" } "#c,carol"
                    ]
        , test "plain conversations send the translated content normally" <|
            \_ ->
                let
                    answered =
                        { room | dmKeyAnswered = Set.fromList [ "dave" ] }
                in
                Expect.equal
                    [ True, True, True ]
                    [ List.member "PRIVMSG #c :\u{0001}ACTION waves\u{0001}\u{000D}\n" (wire (Tuple.second (send "/me waves" room)))
                    , List.member "PRIVMSG dave :hi there\u{000D}\n" (wire (Tuple.second (send "/msg dave hi there" answered)))
                    , List.member "NOTICE #c :hi all\u{000D}\n" (wire (Tuple.second (send "/notice #c hi all" room)))
                    ]
        ]



-- TRANSLATION TABLE


translationSuite : Test
translationSuite =
    let
        lines text =
            wire (Tuple.second (send text room))
    in
    describe "registry verbs Onyx Server answers 421 to are translated"
        [ test "status verbs fill in the open room" <|
            \_ ->
                Expect.equal
                    [ [ "MODE #c +oo alice bob\u{000D}\n" ]
                    , [ "MODE #c -o alice\u{000D}\n" ]
                    , [ "MODE #c +vvv a b c\u{000D}\n", "MODE #c +v d\u{000D}\n" ]
                    , [ "MODE #other -v a\u{000D}\n" ]
                    ]
                    [ lines "/op alice bob", lines "/deop alice", lines "/voice a b c d", lines "/devoice #other a" ]
        , test "bans take a nick or a mask" <|
            \_ ->
                Expect.equal
                    [ [ "MODE #c +b alice!*@*\u{000D}\n" ], [ "MODE #c -b *!*@bad.host\u{000D}\n" ], [] ]
                    [ lines "/ban alice", lines "/unban *!*@bad.host", lines "/ban bad mask!" ]
        , test "kick, topic, invite and part name the room" <|
            \_ ->
                Expect.equal
                    [ [ "KICK #c bob :being rude\u{000D}\n" ]
                    , [ "KICK #c bob\u{000D}\n" ]
                    , [ "TOPIC #c :fresh paint\u{000D}\n" ]
                    , [ "INVITE dave #c\u{000D}\n" ]
                    , [ "INVITE dave #other\u{000D}\n" ]
                    , [ "PART #c\u{000D}\n" ]
                    , [ "PART #c :see you all\u{000D}\n" ]
                    , [ "PART #other\u{000D}\n" ]
                    ]
                    [ lines "/kick bob being rude", lines "/kick bob", lines "/topic fresh paint", lines "/invite dave", lines "/invite dave #other", lines "/part", lines "/part see you all", lines "/leave #other" ]
        , test "bare /topic shows the topic without touching the wire" <|
            \_ ->
                let
                    topical =
                        feed room ":s 332 kai #c :Harbor talk"

                    ( shown, outs ) =
                        send "/topic" topical
                in
                Expect.equal ( [], [ "Topic · #c" ], [ "Harbor talk" ] ) ( wire outs, toastTitles shown, toastDescriptions shown )
        , test "bare /invite opens the invite-share sheet for the room" <|
            \_ ->
                let
                    ( shared, outs ) =
                        send "/invite" room
                in
                Expect.equal ( [], Just "#c", "" ) ( wire outs, Maybe.map .channel shared.inviteShare, shared.composer )
        , test "/j and /join add the # and open the room on the echo" <|
            \_ ->
                let
                    ( joining, outs ) =
                        send "/j lounge" room

                    ( again, againOut ) =
                        send "/join #c" room
                in
                Expect.equal
                    ( [ "JOIN #lounge\u{000D}\n" ], Just "#lounge", [] )
                    ( wire outs, joining.pendingDeepLinkJoin, wire againOut )
                    |> (\e -> Expect.all [ \_ -> e, \_ -> Expect.equal (Just "#c") again.activeChannel ] ())
        , test "/back and /unaway clear away; /away keeps the whole message" <|
            \_ ->
                let
                    ( away, awayOut ) =
                        send "/away gone fishing" room

                    ( back, backOut ) =
                        send "/back" away
                in
                Expect.equal
                    ( [ "AWAY :gone fishing\u{000D}\n" ], [ "AWAY\u{000D}\n" ], [ "AWAY\u{000D}\n" ] )
                    ( wire awayOut, wire backOut, lines "/unaway" )
                    |> (\e -> Expect.all [ \_ -> e, \_ -> Expect.equal ( StatusIdle, StatusOnline ) ( away.userStatus, back.userStatus ) ] ())
        , test "/quote sends the line verbatim; multi-line raw is refused" <|
            \_ ->
                let
                    ( refused, refusedOut ) =
                        send "/quote WHO #c\nQUIT" room
                in
                Expect.equal ( [ "WHO #c\u{000D}\n" ], [], Just "A raw line must be a single line." )
                    ( lines "/raw WHO #c", wire refusedOut, refused.composerError )
        , test "/ctcp wraps the query; its reply notice becomes a toast, not a row" <|
            \_ ->
                let
                    ( asked, outs ) =
                        send "/ctcp alice version" room

                    replied =
                        feed asked ":alice!u@h NOTICE kai :\u{0001}VERSION Onyx 3\u{0001}"

                    stranger =
                        feed asked ":zed!u@h NOTICE kai :\u{0001}VERSION Other\u{0001}"
                in
                Expect.all
                    [ \_ -> Expect.equal [ "PRIVMSG alice \u{0001}VERSION\u{0001}\u{000D}\n" ] (wire outs)
                    , \_ -> Expect.equal [ "VERSION reply from alice" ] (toastTitles replied)
                    , \_ -> Expect.equal [ "Onyx 3" ] (toastDescriptions replied)
                    , \_ -> Expect.equal [] (rows replied "alice")
                    , \_ -> Expect.equal 1 (List.length (rows stranger "zed"))
                    ]
                    ()
        , test "/share copies the room deep link and the receipt toasts it" <|
            \_ ->
                let
                    ( shared, outs ) =
                        send "/share" room

                    copied =
                        step (ClipboardResult { tag = "room-link:#c", ok = True }) shared

                    ( dm, dmOut ) =
                        send "/share" (step (ChannelSelect "alice") room)
                in
                Expect.all
                    [ \_ -> Expect.equal [ ClipboardCopy { text = "https://eshmaki.me/app/?join=%23c", tag = "room-link:#c" } ] outs
                    , \_ -> Expect.equal [ "Room link copied" ] (toastTitles copied)
                    , \_ -> Expect.equal [ "https://eshmaki.me/app/?join=%23c" ] (toastDescriptions copied)
                    , \_ -> Expect.equal ( [], [ "Share a room" ] ) ( dmOut, toastTitles dm )
                    ]
                    ()
        , test "/stage on needs a room operator" <|
            \_ ->
                let
                    ( refused, outs ) =
                        send "/stage on" room
                in
                Expect.equal ( [], [ "Only room operators can start a stage." ] ) ( wire outs, toastDescriptions refused )
        , test "/ping shows latency and probes now" <|
            \_ ->
                let
                    ( pinged, outs ) =
                        send "/ping" room
                in
                Expect.equal ( [ "Latency" ], True ) ( toastTitles pinged, List.any (String.startsWith "PING lat-") (wire outs) )
        , test "usage problems keep the draft and say why inline" <|
            \_ ->
                let
                    ( noNick, noNickOut ) =
                        send "/op" room

                    ( inDm, inDmOut ) =
                        send "/kick bob" (step (ChannelSelect "alice") room)
                in
                Expect.equal
                    ( ( "/op", Just "Use /op <nick>.", [] ), ( "/kick bob", Just "Use /kick in a room, or /kick #room …", [] ) )
                    ( ( noNick.composer, noNick.composerError, noNickOut ), ( inDm.composer, inDm.composerError, inDmOut ) )
        , test "no registry verb reaches the wire as a verb Onyx Server lacks" <|
            \_ ->
                let
                    real =
                        [ "NICK", "MODE", "MODEX", "WEBHOOK", "JOIN", "PART", "TOPIC", "KICK", "INVITE", "NOTICE", "AWAY", "PING", "WHOIS" ]

                    dead =
                        slashCommands
                            |> List.concatMap (\c -> c.name :: c.aliases)
                            |> List.map String.toUpper
                            |> List.filter (\v -> not (List.member v real))

                    answered =
                        { room | dmKeyAnswered = Set.fromList [ "alice", "bob" ] }

                    offenders =
                        slashCommands
                            |> List.filter (\c -> not c.oper && c.kind == SlashIrc)
                            |> List.concatMap (\c -> c.name :: c.aliases)
                            |> List.concatMap
                                (\v ->
                                    wire (Tuple.second (send ("/" ++ v ++ " alice hello") answered))
                                        |> List.filter (\line -> List.member (List.head (String.words line) |> Maybe.withDefault "") dead)
                                        |> List.map (\line -> ( v, line ))
                                )
                in
                Expect.equal [] offenders
        ]



-- INBOUND / OUTBOUND ACTION ROWS


actionSuite : Test
actionSuite =
    let
        shape m =
            ( m.from, displayBody m, m.msgType )
    in
    describe "CTCP ACTION renders as an action row"
        [ test "a channel ACTION files an action row (and highlights)" <|
            \_ ->
                Expect.equal [ ( ( "alice", "waves at kai", "action" ), True ) ]
                    (List.map (\m -> ( shape m, m.highlight )) (rows (feed room ":alice!u@h PRIVMSG #c :\u{0001}ACTION waves at kai\u{0001}") "#c"))
        , test "a DM ACTION files under the sender" <|
            \_ ->
                Expect.equal [ ( "alice", "nods", "action" ) ]
                    (List.map shape (rows (feed room ":alice!u@h PRIVMSG kai :\u{0001}ACTION nods\u{0001}") "alice"))
        , test "history replay keeps ACTION rows" <|
            \_ ->
                let
                    replayed =
                        room
                            |> (\m -> feed m "BATCH +h1 chathistory #c")
                            |> (\m -> feed m "@batch=h1;time=2026-10-04T12:00:00Z :alice!u@h PRIVMSG #c :\u{0001}ACTION stretches\u{0001}")
                            |> (\m -> feed m "BATCH -h1")
                in
                Expect.equal [ ( "alice", "stretches", "action" ) ] (List.map shape (rows replayed "#c"))
        , test "a missing closing delimiter still reads as an action; ACTIONS does not" <|
            \_ ->
                Expect.equal ( [ ( "alice", "waves", "action" ) ], [] )
                    ( List.map shape (rows (feed room ":alice!u@h PRIVMSG #c :\u{0001}ACTION waves") "#c")
                    , List.map shape (rows (feed room ":alice!u@h PRIVMSG #c :\u{0001}ACTIONS x\u{0001}") "#c")
                    )
        , test "ACTION persists to the vault; queries still never do" <|
            \_ ->
                Expect.equal ( False, True )
                    ( isSwallowedCtcpWire "kai" (Wire.parseIrcMessage ":alice!u@h PRIVMSG #c :\u{0001}ACTION waves\u{0001}")
                    , isSwallowedCtcpWire "kai" (Wire.parseIrcMessage ":alice!u@h PRIVMSG #c :\u{0001}VERSION\u{0001}")
                    )
        , test "an own /me renders as an action row and persists as one" <|
            \_ ->
                let
                    ( sent, outs ) =
                        send "/me waves" room

                    vaultTypes =
                        List.concatMap
                            (\o ->
                                case o of
                                    VaultPersist req ->
                                        List.map (\r -> ( r.body, r.rowType )) req.rows

                                    _ ->
                                        []
                            )
                            outs
                in
                Expect.equal ( [ ( "kai", "waves", "action" ) ], [ ( "waves", "action" ) ] ) ( List.map shape (rows sent "#c"), vaultTypes )
        , test "the echo of an own /me stays an action row (echo-message and labeled)" <|
            \_ ->
                let
                    echoed =
                        feed { room | caps = [ "echo-message" ] } "@msgid=m1 :kai!u@h PRIVMSG #c :\u{0001}ACTION waves\u{0001}"

                    labeled =
                        { room | caps = [ "labeled-response", "echo-message" ] }

                    ( pending, outs ) =
                        send "/me waves" labeled

                    label =
                        wire outs
                            |> List.filterMap (\line -> List.head (String.words line))
                            |> List.filter (String.startsWith "@label=")
                            |> List.head
                            |> Maybe.map (String.dropLeft 7)
                            |> Maybe.withDefault "?"

                    confirmed =
                        feed pending ("@label=" ++ label ++ ";msgid=m2 :kai!u@h PRIVMSG #c :\u{0001}ACTION waves\u{0001}")
                in
                Expect.equal ( [ ( "kai", "waves", "action" ) ], [ ( ( "kai", "waves", "action" ), False ) ] )
                    ( List.map shape (rows echoed "#c"), List.map (\m -> ( shape m, m.pending )) (rows confirmed "#c") )
        , test "a sealed /me opens as an action row (the envelope is never touched)" <|
            \_ ->
                let
                    sealed =
                        { id = 1, from = "bob", body = "ONYXDM1 abc", whisper = False, audience = Nothing, highlight = False, outboxId = Nothing, pending = False, plaintext = Just "\u{0001}ACTION hugs\u{0001}", at = 0, msgid = Nothing, reactions = [], edited = False, deleted = False, redacted = False, topic = "", msgType = "msg", replyTo = Nothing }

                    normalized =
                        normalizeActionRow sealed
                in
                Expect.equal ( Just "hugs", ( "action", "ONYXDM1 abc", Just "hugs" ), "hugs" )
                    ( messageAction sealed, ( normalized.msgType, normalized.body, normalized.plaintext ), displayBody sealed )
        , test "action rows read as a sentence and never group" <|
            \_ ->
                let
                    acted =
                        rows (feed room ":alice!u@h PRIVMSG #c :\u{0001}ACTION waves\u{0001}") "#c"
                in
                case acted of
                    [ m ] ->
                        Expect.equal ( "alice waves", False, False )
                            ( messageAccessibleLabel m
                            , TranscriptRows.isContinuation m { m | msgType = "msg", id = 2 }
                            , TranscriptRows.isContinuation { m | msgType = "msg" } m
                            )

                    _ ->
                        Expect.fail "one action row"
        , test "an own action row deletes but never edits" <|
            \_ ->
                let
                    echoed =
                        feed { room | caps = [ "echo-message" ] } "@msgid=m1 :kai!u@h PRIVMSG #c :\u{0001}ACTION waves\u{0001}"
                in
                Expect.equal ( True, False ) ( canDeleteRow echoed "#c" "m1", canEditRow echoed "#c" "m1" )
        , test "text exports write `* nick action`" <|
            \_ ->
                Transcript.transcriptToText
                    { target = "#c", messageCount = 1, exportedAt = "t", ourNick = "kai", messages = [ { id = "1", time = "t1", from = "alice", type_ = "action", text = "waves", edited = False } ] }
                    |> String.contains "[t1] * alice waves"
                    |> Expect.equal True
        , test "ctcpActionText strips stray delimiters so the text never re-parses as CTCP" <|
            \_ ->
                Expect.equal [ Just "a b", Just "", Nothing, Nothing ]
                    [ ctcpActionText "\u{0001}ACTION a\u{0001} b\u{0001}"
                    , ctcpActionText "\u{0001}ACTION\u{0001}"
                    , ctcpActionText "ACTION waves"
                    , ctcpActionText "\u{0001}ACTIONwaves\u{0001}"
                    ]
        , test "the /me wire body is one line" <|
            \_ ->
                Expect.equal "\u{0001}ACTION waves twice\u{0001}" (ctcpActionWire "waves\n  twice\u{0001}")
        ]



-- /help


helpSuite : Test
helpSuite =
    describe "/help lists exactly the verbs that work"
        [ test "every non-operator registry verb is listed once; nothing else is" <|
            \_ ->
                let
                    listed =
                        List.concatMap (Tuple.second >> List.map .name) (slashHelpGroups False)

                    registry =
                        List.filter (not << .oper) slashCommands |> List.map .name
                in
                Expect.equal ( List.sort registry, List.length listed ) ( List.sort listed, List.length registry )
        , test "operator verbs list for operators only" <|
            \_ ->
                Expect.equal ( False, True )
                    ( List.member "Operators" (List.map Tuple.first (slashHelpGroups False))
                    , List.member "Operators" (List.map Tuple.first (slashHelpGroups True))
                    )
        , test "bare /help opens the commands sheet; Escape closes it first" <|
            \_ ->
                let
                    ( helped, outs ) =
                        send "/help" room
                in
                Expect.equal ( True, [], Just CommandsHelpClose ) ( helped.commandsHelpOpen, outs, escapeMsg helped )
        , test "picking a command drops it into the composer" <|
            \_ ->
                let
                    picked =
                        step (CommandsHelpInsert "me") { room | commandsHelpOpen = True }
                in
                Expect.equal ( False, "/me " ) ( picked.commandsHelpOpen, picked.composer )
        , test "/help <verb> still explains one verb" <|
            \_ ->
                Expect.equal [ "/share" ] (toastTitles (Tuple.first (send "/help share" room)))
        ]



-- PALETTE


twoRooms : Model
twoRooms =
    room
        |> (\m -> feed m ":kai!u@h JOIN #d")
        |> (\m -> feed m ":carol!u@h PRIVMSG #d :hello d")
        |> step (ChannelSelect "#c")


paletteSuite : Test
paletteSuite =
    describe "palette breadth"
        [ test "People: members of the open room, never self, never an existing DM" <|
            \_ ->
                let
                    withDm =
                        feed room ":alice!u@h PRIVMSG kai :hi"

                    titles =
                        paletteTitles (openPalette withDm)
                in
                Expect.equal ( True, False, False )
                    ( List.member "Message bob" titles, List.member "Message kai" titles, List.member "Message alice" titles )
        , test "typing a name adds a profile row" <|
            \_ ->
                Expect.equal True (List.member "View profile: bob" (paletteTitles (step (PaletteInput "bob") (openPalette room))))
        , test "people match on their name, not the shared row wording" <|
            \_ ->
                let
                    titles =
                        paletteTitles (step (PaletteInput "i") (openPalette room))
                in
                Expect.equal ( False, False ) ( List.member "Message bob" titles, List.any (String.startsWith "View profile") titles )
        , test "a People row opens the DM" <|
            \_ ->
                let
                    ( opened, _ ) =
                        runTitle "Message bob" (openPalette room)
                in
                Expect.equal ( Just "bob", True, False ) ( opened.activeChannel, Dict.member "bob" opened.channels, opened.palette.open )
        , test "recents: a run row leads the quiet palette in its own section, owner-scoped" <|
            \_ ->
                let
                    ( ran, outs ) =
                        runTitle "Go to #d" (openPalette twoRooms)

                    reopened =
                        openPalette ran

                    other =
                        openPalette { ran | ourNick = "zed" }
                in
                Expect.all
                    [ \_ -> Expect.equal [ PaletteRecentsSave { owner = "wss://onyx.example/ws|kai", ids = [ "channel:#d" ] } ] (List.filter isRecentSave outs)
                    , \_ -> Expect.equal (Just ( Switcher.Recent, "Go to #d" )) (List.head (List.map (\m -> ( m.entry.section, m.entry.title )) (paletteMatches reopened)))
                    , \_ -> Expect.equal (Just Switcher.Rooms) (List.head (List.map (.entry >> .section) (paletteMatches other)))
                    ]
                    ()
        , test "stored recents load for their owner" <|
            \_ ->
                let
                    loaded =
                        step (GapPrefsLoaded (Encode.object [ ( "recents", Encode.object [ ( "wss://onyx.example/ws|kai", Encode.list Encode.string [ "action:preferences" ] ) ] ), ( "singleKeys", Encode.bool False ) ])) twoRooms
                in
                Expect.equal ( Just "Preferences — display & behaviour", False )
                    ( List.head (paletteTitles (openPalette loaded)), loaded.singleKeyShortcuts )
        , test "Disconnect never becomes a recent" <|
            \_ ->
                Expect.equal [] (List.filter isRecentSave (Tuple.second (runTitle "Disconnect" (openPalette room))))
        , test "the oracle action rows are all offered in a room" <|
            \_ ->
                let
                    titles =
                        paletteTitles (openPalette twoRooms)
                in
                Expect.equal []
                    (List.filter (\t -> not (List.member t titles))
                        [ "Copy room link", "Invite people to #c", "Start voice call", "Star #c", "Mute #c", "Mark #c read", "Leave #c", "Catch up: #d", "Mark all read", "Search messages", "Scheduled messages", "Turn on Do Not Disturb", "Set yourself away", "Compact message density", "Preferences — display & behaviour", "Open Theme Studio", "Slash commands", "Copy node address", "Jump to date…" ]
                    )
        , test "rows reuse the existing intents" <|
            \_ ->
                let
                    after title =
                        runTitle title (openPalette twoRooms)

                    model title =
                        Tuple.first (after title)

                    outs title =
                        Tuple.second (after title)
                in
                Expect.all
                    [ \_ -> Expect.equal True (model "Preferences — display & behaviour").prefsOpen
                    , \_ -> Expect.equal True (List.member (PushUrl "/appearance") (outs "Open Theme Studio"))
                    , \_ -> Expect.equal True (model "Scheduled messages").showScheduledMessages
                    , \_ -> Expect.equal True (List.member (ClipboardCopy { text = "https://eshmaki.me/app/?join=%23c", tag = "room-link:#c" }) (outs "Copy room link"))
                    , \_ -> Expect.equal True (List.member (VoiceJoin { channel = "#c", video = False }) (outs "Start voice call"))
                    , \_ -> Expect.equal True (Set.member "#c" (model "Star #c").starredChannels)
                    , \_ -> Expect.equal "none" (notifyLevel (model "Mute #c") "#c")
                    , \_ -> Expect.equal True (List.member "PART #c\u{000D}\n" (wire (outs "Leave #c")))
                    , \_ -> Expect.equal True (model "Turn on Do Not Disturb").dndEnabled
                    , \_ -> Expect.equal StatusIdle (model "Set yourself away").userStatus
                    , \_ -> Expect.equal Prefs.TranscriptCompact (model "Compact message density").prefs.transcriptDensity
                    , \_ -> Expect.equal True (model "Slash commands").commandsHelpOpen
                    , \_ -> Expect.equal True (model "Search messages").searchOpen
                    , \_ -> Expect.equal (Just "#d") (model "Catch up: #d").activeChannel
                    , \_ -> Expect.equal 0 (Maybe.withDefault -1 (Maybe.map .unread (Dict.get "#d" (model "Mark all read").channels)))
                    , \_ -> Expect.equal True (List.member (ClipboardCopy { text = "wss://onyx.example/ws", tag = "node-address" }) (outs "Copy node address"))
                    ]
                    ()
        , test "query grammar: #room joins, mute N pauses alerts, theme names switch" <|
            \_ ->
                let
                    typed q =
                        step (PaletteInput q) (openPalette room)

                    ( joined, joinOut ) =
                        runTitle "Join #lounge" (typed "#lounge")

                    ( paused, _ ) =
                        runTitle "Pause alerts for 30 minutes" (typed "mute 30")

                    ( themed, _ ) =
                        runTitle "Switch theme: Pearl" (typed "pearl")
                in
                Expect.all
                    [ \_ -> Expect.equal ( [ "JOIN #lounge\u{000D}\n" ], Just "#lounge" ) ( wire joinOut, joined.pendingDeepLinkJoin )
                    , \_ -> Expect.notEqual Nothing paused.dndUntil
                    , \_ -> Expect.equal "pearl" themed.themeId
                    , \_ -> Expect.equal False (List.member "Join #c" (paletteTitles (typed "#c")))
                    ]
                    ()
        , test "a typed query ranks the best action first" <|
            \_ ->
                Expect.equal (Just "Preferences — display & behaviour")
                    (List.head (paletteTitles (step (PaletteInput "prefer") (openPalette room))))
        , test "People rows stay short on a quiet palette" <|
            \_ ->
                let
                    crowd =
                        List.foldl (\i m -> feed m (":p" ++ String.fromInt i ++ "!u@h JOIN #c")) room (List.range 1 30)
                in
                Expect.equal ( 5, 12 )
                    ( List.length (List.filter (\m -> m.entry.section == Switcher.People) (paletteMatches (openPalette crowd)))
                    , List.length (List.filter (\m -> m.entry.section == Switcher.People) (paletteMatches (step (PaletteInput "p") (openPalette crowd))))
                    )
        ]


isRecentSave : Outbound -> Bool
isRecentSave o =
    case o of
        PaletteRecentsSave _ ->
            True

        _ ->
            False



-- CHORDS


chordSuite : Test
chordSuite =
    let
        withDm =
            feed twoRooms ":alice!u@h PRIVMSG kai :ping"
    in
    describe "shell chords"
        [ test "the port names decode" <|
            \_ ->
                Expect.equal
                    [ Switcher.AppChord (Switcher.ConversationStep -1)
                    , Switcher.AppChord (Switcher.ConversationStep 1)
                    , Switcher.AppChord (Switcher.UnreadStep -1)
                    , Switcher.AppChord (Switcher.UnreadStep 1)
                    , Switcher.AppChord (Switcher.UnreadStep 1)
                    , Switcher.AppChord Switcher.GoHome
                    , Switcher.AppChord Switcher.GoJumpToDate
                    , Switcher.AppChord Switcher.OpenPreferences
                    , Switcher.AppChord Switcher.OpenAccount
                    , Switcher.AppChord Switcher.MarkConversationRead
                    , Switcher.AppChord Switcher.ToggleDndChord
                    , Switcher.AppChord Switcher.ToggleRoomMute
                    , Switcher.AppChord Switcher.ToggleRoomStar
                    , Switcher.AppChord Switcher.AttachFiles
                    , Switcher.AppChord Switcher.ScheduleSend
                    , Switcher.AppChord Switcher.ExportTranscript
                    , Switcher.AppChord Switcher.FollowToggle
                    , Switcher.SingleKeys True
                    , Switcher.SingleKeys False
                    , Switcher.UnknownShortcut
                    ]
                    (List.map Switcher.shortcutFromString
                        [ "conv-prev", "conv-next", "unread-prev", "unread-next", "next-unread", "go-home", "go-date", "prefs", "account", "mark-read", "dnd", "room-mute", "room-star", "attach", "schedule", "export", "follow", "single-keys-on", "single-keys-off", "message-next" ]
                    )
        , test "Alt+↑/↓ follow the sidebar order and wrap" <|
            \_ ->
                let
                    stepped delta model =
                        Tuple.first (chord (Switcher.ConversationStep delta) model)
                in
                Expect.equal [ Just "#d", Just "alice", Just "#c", Just "alice" ]
                    [ (stepped 1 withDm).activeChannel
                    , (stepped 1 (stepped 1 withDm)).activeChannel
                    , (stepped 1 (stepped 1 (stepped 1 withDm))).activeChannel
                    , (stepped -1 withDm).activeChannel
                    ]
        , test "the order matches the sidebar sections (favorites, rooms, DMs by recency)" <|
            \_ ->
                let
                    starred =
                        { withDm | starredChannels = Set.singleton "#d" }

                    sections =
                        Sidebar.sections { isChannel = isChannelName starred, starred = starred.starredChannels, query = "", unreadOnly = False } (Dict.values starred.channels)
                in
                Expect.equal (List.map .name (sections.favorites ++ sections.rooms ++ sections.dms))
                    (Switcher.conversationOrder (isChannelName starred) (\n -> Set.member (String.toLower n) starred.starredChannels) (Dict.values starred.channels))
        , test "Alt+Shift+↓ / N jump to the next unread; none left says so" <|
            \_ ->
                let
                    ( next, _ ) =
                        chord (Switcher.UnreadStep 1) withDm

                    ( none, _ ) =
                        chord (Switcher.UnreadStep 1) room
                in
                Expect.equal ( Just "#d", [ "All caught up" ] ) ( next.activeChannel, toastTitles none )
        , test "G then H goes home; G then D opens jump-to-date" <|
            \_ ->
                Expect.equal ( Nothing, True )
                    ( (Tuple.first (chord Switcher.GoHome room)).activeChannel
                    , (Tuple.first (chord Switcher.GoJumpToDate room)).showJumpToDate
                    )
        , test "room chords toggle and never touch the draft" <|
            \_ ->
                let
                    drafting =
                        { room | composer = "half a thought" }

                    starred =
                        Tuple.first (chord Switcher.ToggleRoomStar drafting)

                    unstarred =
                        Tuple.first (chord Switcher.ToggleRoomStar starred)

                    muted =
                        Tuple.first (chord Switcher.ToggleRoomMute drafting)

                    read =
                        Tuple.first (chord Switcher.MarkConversationRead drafting)

                    ( exported, exportOut ) =
                        chord Switcher.ExportTranscript drafting
                in
                Expect.all
                    [ \_ -> Expect.equal ( True, False ) ( Set.member "#c" starred.starredChannels, Set.member "#c" unstarred.starredChannels )
                    , \_ -> Expect.equal "none" (notifyLevel muted "#c")
                    , \_ -> Expect.equal [ "half a thought", "half a thought", "half a thought", "half a thought" ] [ starred.composer, muted.composer, read.composer, exported.composer ]
                    , \_ -> Expect.equal True (List.any isDownload exportOut)
                    ]
                    ()
        , test "preferences, DND, follow" <|
            \_ ->
                let
                    followed =
                        Tuple.first (chord Switcher.FollowToggle room)
                in
                Expect.equal ( True, True, True )
                    ( (Tuple.first (chord Switcher.OpenPreferences room)).prefsOpen
                    , (Tuple.first (chord Switcher.ToggleDndChord room)).dndEnabled
                    , Set.member (followKey "#c" Nothing) followed.followed
                    )
        , test "chords are inert under the palette, the shortcuts sheet and off the app shell" <|
            \_ ->
                let
                    tried model =
                        Tuple.first (chord Switcher.OpenPreferences model)
                in
                Expect.equal [ False, False, False ]
                    [ (tried (openPalette room)).prefsOpen
                    , (tried { room | shortcutsOpen = True }).prefsOpen
                    , (tried { room | route = Route.Landing }).prefsOpen
                    ]
        , test "the single-key switch flips and persists" <|
            \_ ->
                let
                    ( off, outs ) =
                        update SingleKeysToggle room
                in
                Expect.equal ( False, [ SingleKeysSave { enabled = False } ] ) ( off.singleKeyShortcuts, outs )
        , test "the overlay lists every new chord group" <|
            \_ ->
                Expect.equal [ "Palette", "Navigation", "Chat", "View", "Voice & Video" ] (List.map .group Switcher.shortcutGroups)
        ]


isDownload : Outbound -> Bool
isDownload o =
    case o of
        TranscriptDownload _ ->
            True

        _ ->
            False



-- VIEWS


viewSuite : Test
viewSuite =
    describe "views"
        [ test "an action row reads `* nick text` with its own class" <|
            \_ ->
                html (feed room ":alice!u@h PRIVMSG #c :\u{0001}ACTION waves\u{0001}")
                    |> Query.find [ Selector.class "onyx-message--action" ]
                    |> Query.has [ Selector.text "*", Selector.text "alice", Selector.text "waves", Selector.class "onyx-continuation" ]
        , test "the commands sheet lists working verbs as launchers" <|
            \_ ->
                let
                    sheet =
                        html { room | commandsHelpOpen = True }
                            |> Query.find [ attr "data-testid" "commands-help" ]
                in
                Expect.all
                    [ \_ -> sheet |> Query.has [ Selector.text "Slash commands", Selector.text "/me <action>", Selector.text "/share", Selector.text "/stage [on|off]" ]
                    , \_ -> sheet |> Query.hasNot [ Selector.text "/kill <nick> <reason>" ]
                    , \_ ->
                        sheet
                            |> Query.find [ attr "data-command" "me" ]
                            |> Event.simulate Event.click
                            |> Event.expect (CommandsHelpInsert "me")
                    ]
                    ()
        , test "the shortcuts overlay carries the new chords and the single-key switch" <|
            \_ ->
                let
                    overlay =
                        html { room | shortcutsOpen = True }
                in
                Expect.all
                    [ \_ -> overlay |> Query.has [ Selector.text "Previous room / DM", Selector.text "Move to next message", Selector.text "Open preferences" ]
                    , \_ ->
                        overlay
                            |> Query.find [ attr "data-testid" "single-keys-switch" ]
                            |> Query.has [ attr "role" "switch", attr "aria-checked" "true" ]
                    , \_ ->
                        overlay
                            |> Query.find [ attr "data-testid" "single-keys-switch" ]
                            |> Event.simulate Event.click
                            |> Event.expect SingleKeysToggle
                    ]
                    ()
        , test "the palette renders the People section" <|
            \_ ->
                html (openPalette room)
                    |> Query.find [ attr "data-section" "People" ]
                    |> Query.has [ Selector.text "Message bob" ]
        ]
