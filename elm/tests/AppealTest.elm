module AppealTest exposing (suite)

{-| v3/gap-oper — the person's side of APPEAL: the connect-screen
button, the sheet, the queued pre-registration send, and the answers.
-}

import App exposing (ConnectionState(..), Model, Msg(..), Outbound(..), blank, update)
import Expect
import Html
import Html.Attributes as Attr
import OperConsole as C exposing (UserAppeal(..))
import OperReply
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Route
import View


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


sent : List Outbound -> List String
sent =
    List.filterMap
        (\o ->
            case o of
                SendLine l ->
                    Just (String.replace "\u{000D}\n" "" l)

                _ ->
                    Nothing
        )


typed : String -> Model -> Model
typed text model =
    let
        console =
            model.operConsole
    in
    { model | operConsole = { console | forms = C.setField C.AppealText text console.forms } }


opened : Model -> Model
opened model =
    update (OperConsoleMsg C.OpenUserAppeal) model |> Tuple.first


offline : Model
offline =
    { blank | connectGate = True, route = Route.App, connection = Offline, ourNick = "kai" }


live : Model
live =
    { blank | connection = Live, ourNick = "kai" }


suite : Test
suite =
    describe "v3/gap-oper appeal (the person's side)"
        [ describe "reaching it"
            [ test "the connect screen carries an Appeal a ban button" <|
                \_ ->
                    query offline
                        |> Query.find [ testId "appeal-open" ]
                        |> Event.simulate Event.click
                        |> Event.expect (OperConsoleMsg C.OpenUserAppeal)
            , test "the sheet opens, and closes again" <|
                \_ ->
                    Expect.equal ( True, False )
                        ( (opened offline).operConsole.userAppealOpen
                        , (update (OperConsoleMsg C.CloseUserAppeal) (opened offline) |> Tuple.first).operConsole.userAppealOpen
                        )
            , test "the sheet shows the form, and no operator desk" <|
                \_ ->
                    Expect.all
                        [ \q -> q |> Query.findAll [ testId "appeal-sheet" ] |> Query.count (Expect.equal 1)
                        , \q -> q |> Query.findAll [ testId "appeal-form-appeal" ] |> Query.count (Expect.equal 1)
                        , \q -> q |> Query.findAll [ testId "oper-sheet" ] |> Query.count (Expect.equal 0)
                        ]
                        (query (opened offline))
            , test "/appeal opens the sheet prefilled" <|
                \_ ->
                    let
                        ( m, out ) =
                            update ComposerSend { live | activeChannel = Just "#c", composer = "/appeal I was banned by mistake" }
                    in
                    Expect.equal ( True, "I was banned by mistake", [] )
                        ( m.operConsole.userAppealOpen, m.operConsole.forms.appealText, sent out )
            , test "Escape closes the sheet (it is on the overlay stack)" <|
                \_ ->
                    Expect.equal True (List.member "appeal-sheet" (List.map Tuple.first (App.overlayStack (opened offline))))
            ]
        , describe "filing"
            [ test "online, the appeal goes out at once as APPEAL :text" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (OperConsoleMsg C.SendUserAppeal) (typed "My brother shares my connection, we are two people." live)
                    in
                    Expect.equal ( [ "APPEAL :My brother shares my connection, we are two people." ], AppealSending )
                        ( sent out, m.operConsole.userAppeal )
            , test "offline, it is saved, not sent" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (OperConsoleMsg C.SendUserAppeal) (typed "please look again" offline)
                    in
                    Expect.equal ( [], AppealQueued ) ( sent out, m.operConsole.userAppeal )
            , test "a saved appeal goes out FIRST on the next socket, ahead of the handshake" <|
                \_ ->
                    let
                        queued =
                            update (OperConsoleMsg C.SendUserAppeal) (typed "please look again" offline) |> Tuple.first

                        ( m, out ) =
                            update (WsOpened { url = "wss://irc.example/ws" }) queued
                    in
                    Expect.equal ( Just "APPEAL :please look again", AppealSending )
                        ( List.head (sent out), m.operConsole.userAppeal )
            , test "nothing is sent on connect when no appeal is waiting" <|
                \_ ->
                    let
                        ( _, out ) =
                            update (WsOpened { url = "wss://irc.example/ws" }) offline
                    in
                    Expect.equal False (List.any (String.startsWith "APPEAL") (sent out))
            , test "an empty appeal is refused without sending or queuing" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (OperConsoleMsg C.SendUserAppeal) offline
                    in
                    Expect.equal ( [], True )
                        ( sent out
                        , case m.operConsole.userAppeal of
                            AppealRefused _ ->
                                True

                            _ ->
                                False
                        )
            ]
        , describe "answers"
            [ test "the filed number comes back before registration (to *)" <|
                \_ ->
                    let
                        sending =
                            update (OperConsoleMsg C.SendUserAppeal) (typed "please look again" live) |> Tuple.first

                        ( m, _ ) =
                            update (WsLineReceived ":onyx.test NOTICE * :APPEAL filed 12") sending
                    in
                    Expect.equal (AppealFiledAs 12) m.operConsole.userAppeal
            , test "the filed copy says nobody will write back" <|
                \_ ->
                    let
                        sending =
                            update (OperConsoleMsg C.SendUserAppeal) (typed "please look again" (opened live)) |> Tuple.first

                        filed =
                            update (WsLineReceived ":onyx.test NOTICE kai :APPEAL filed 12") sending |> Tuple.first
                    in
                    query filed |> Query.find [ testId "appeal-status" ] |> Query.has [ Selector.text "Appeal 12 is filed", Selector.text "no automatic reply" ]
            , test "a second appeal inside the hour is explained" <|
                \_ ->
                    let
                        sending =
                            update (OperConsoleMsg C.SendUserAppeal) (typed "again" (opened live)) |> Tuple.first

                        refused =
                            update (WsLineReceived ":onyx.test NOTICE kai :APPEAL already filed") sending |> Tuple.first
                    in
                    query refused |> Query.find [ testId "appeal-status" ] |> Query.has [ Selector.text "already on file" ]
            , test "a stranger cannot fake the answer" <|
                \_ ->
                    let
                        sending =
                            update (OperConsoleMsg C.SendUserAppeal) (typed "please look again" live) |> Tuple.first

                        ( m, _ ) =
                            update (WsLineReceived ":mallory!m@evil.example NOTICE kai :APPEAL filed 99") sending
                    in
                    Expect.equal AppealSending m.operConsole.userAppeal
            , test "a closed socket before the answer is explained, not left spinning" <|
                \_ ->
                    let
                        sending =
                            update (OperConsoleMsg C.SendUserAppeal) (typed "please look again" live) |> Tuple.first

                        ( m, _ ) =
                            update (WsClosed { clean = False, reason = "" }) sending
                    in
                    Expect.equal True
                        (case m.operConsole.userAppeal of
                            AppealRefused text ->
                                String.contains "closed" text

                            _ ->
                                False
                        )
            ]
        , describe "/desk"
            [ test "an operator opens the desk on a named tab" <|
                \_ ->
                    let
                        ( m, _ ) =
                            update ComposerSend { live | isOper = True, activeChannel = Just "#c", composer = "/desk bans" }
                    in
                    Expect.equal ( True, OperReply.Bans ) ( m.operDeskOpen, m.operConsole.tab )
            , test "/desk also learns what the session follows (as opening the desk does)" <|
                \_ ->
                    let
                        ( _, out ) =
                            update ComposerSend { live | isOper = True, activeChannel = Just "#c", composer = "/desk" }
                    in
                    Expect.equal [ "EVENT LIST" ] (sent out)
            , test "a person who is not an operator is refused" <|

                \_ ->
                    let
                        ( m, _ ) =
                            update ComposerSend { live | isOper = False, activeChannel = Just "#c", composer = "/desk bans" }
                    in
                    Expect.equal ( False, [ "Operator access required" ] ) ( m.operDeskOpen, List.map .title m.toasts )
            ]
        ]
