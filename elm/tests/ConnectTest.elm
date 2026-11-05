module ConnectTest exposing (suite)

{-| Vectors for the v3/connect-gate slice (ported from v3 `c18b9591`
`ConnectTest.elm`, adapted to runtime-owned credentials): visibility,
the guest name path through the confirmed `NICK` change, the optional
room through the deep-link join, sign-in through the runtime IDENTIFY
(no password in the model or on the wire from Elm), the create-account
hand-off to the guest-claim sheet, skip, and the rendered form.
-}

import App exposing (..)
import ConnectGate
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Route
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


armed : Model
armed =
    { blank | connectGate = Just ConnectGate.arm, route = Route.App, connection = Live, ourNick = "guest42" }


withGate : (ConnectGate.Gate -> ConnectGate.Gate) -> Model -> Model
withGate change model =
    { model | connectGate = Maybe.map change model.connectGate }


stamp : RuntimeOwnerStamp
stamp =
    { ownerRef = "owner-1", networkId = "custom", accountId = Nothing, accountGeneration = 1, connectionGeneration = 2 }


lines : List Outbound -> List String
lines =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    Just (String.trim line)

                _ ->
                    Nothing
        )


render : Model -> Query.Single Msg
render model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


suite : Test
suite =
    describe "v3/connect-gate"
        [ visibility
        , guestPath
        , signInPath
        , registerPath
        , viewSuite
        , pureSuite
        ]


visibility : Test
visibility =
    describe "connectGateVisible"
        [ test "an armed gate on /app shows" <|
            \_ -> Expect.equal True (connectGateVisible armed)
        , test "an unarmed gate (boot ?nick=) never shows" <|
            \_ -> Expect.equal False (connectGateVisible { armed | connectGate = Nothing })
        , test "other routes never show the gate" <|
            \_ -> Expect.equal False (connectGateVisible { armed | route = Route.Landing })
        , test "a signed-in or resumed account never sees the gate, and the settle retires it" <|
            \_ ->
                let
                    signed =
                        step ShellFocusSettled { armed | accountName = Just "alice" }
                in
                Expect.equal ( False, Nothing ) ( connectGateVisible { armed | accountName = Just "alice" }, signed.connectGate )
        , test "the gate stays up while the socket is still connecting" <|
            \_ -> Expect.equal True (connectGateVisible { armed | connection = Registering })
        , test "Look around first closes the gate and lands focus on Home" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSkip armed
                in
                Expect.equal ( Nothing, [ FocusElement "home-title" ] ) ( next.connectGate, out )
        ]


guestPath : Test
guestPath =
    describe "guest"
        [ test "a chosen name asks the network with NICK and waits for it" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSubmit (withGate (\g -> { g | name = "  kai " }) armed)
                in
                Expect.all
                    [ \_ -> Expect.equal [ "NICK kai" ] (lines out)
                    , \_ -> Expect.equal (Just "kai") (Maybe.andThen .pending next.connectGate)
                    , \_ -> Expect.equal (Just "kai") next.connectionNickPending
                    , \_ -> Expect.equal True (connectGateVisible next)
                    ]
                    ()
        , test "the confirmed rename closes the gate" <|
            \_ ->
                let
                    asked =
                        step ConnectGateSubmit (withGate (\g -> { g | name = "kai" }) armed)

                    confirmed =
                        feed asked ":guest42!u@h NICK kai"
                in
                Expect.equal ( "kai", Nothing, False ) ( confirmed.ourNick, confirmed.connectGate, connectGateVisible confirmed )
        , test "a refused name clears the wait and keeps the refusal copy" <|
            \_ ->
                let
                    asked =
                        step ConnectGateSubmit (withGate (\g -> { g | name = "kai" }) armed)

                    refused =
                        feed asked ":srv 433 guest42 kai :Nickname is already in use"
                in
                Expect.all
                    [ \_ -> Expect.equal (Just Nothing) (Maybe.map .pending refused.connectGate)
                    , \_ -> Expect.equal True (connectGateVisible refused)
                    , \_ -> Expect.notEqual Nothing refused.connectionDialogError
                    ]
                    ()
        , test "a blank name keeps the current one and closes at once" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSubmit armed
                in
                Expect.equal ( Nothing, [ FocusElement "home-title" ] ) ( next.connectGate, out )
        , test "an optional room joins through the deep-link path" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSubmit (withGate (\g -> { g | room = "lounge" }) armed)
                in
                Expect.equal ( [ "JOIN #lounge" ], Just "#lounge", Nothing ) ( lines out, next.pendingDeepLinkJoin, next.connectGate )
        , test "a confirmed rename then joins the chosen room" <|
            \_ ->
                let
                    asked =
                        step ConnectGateSubmit (withGate (\g -> { g | name = "kai", room = "#lounge" }) armed)

                    ( _, out ) =
                        update (WsLineReceived ":guest42!u@h NICK kai") asked
                in
                Expect.equal True (List.member "JOIN #lounge" (lines out))
        , test "a bad room refuses before any wire line" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSubmit (withGate (\g -> { g | name = "kai", room = "two words" }) armed)
                in
                Expect.equal ( [], True ) ( lines out, Maybe.andThen .error next.connectGate /= Nothing )
        , test "an invalid name refuses before any wire line" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSubmit (withGate (\g -> { g | name = "two words" }) armed)
                in
                Expect.equal ( [], True ) ( lines out, Maybe.andThen .error next.connectGate /= Nothing )
        , test "submitting before the socket is live refuses with guidance" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSubmit (withGate (\g -> { g | name = "kai" }) { armed | connection = Registering })
                in
                Expect.equal ( [], True ) ( out, Maybe.andThen .error next.connectGate /= Nothing )
        ]


signInPath : Test
signInPath =
    describe "sign in"
        [ test "hands the account to the runtime IDENTIFY; nothing credential-bearing leaves Elm" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSubmit
                            (withGate (\g -> { g | mode = ConnectGate.SignIn, name = " alice " }) { armed | runtimeOwnerStamp = Just stamp })
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "alice") next.identifyReplyAccount
                    , \_ -> Expect.equal [] (lines out)
                    , \_ ->
                        Expect.equal True
                            (List.any
                                (\o ->
                                    case o of
                                        PrivateIdentifyRequested req ->
                                            req.account == "alice" && req.ownerRef == "owner-1"

                                        _ ->
                                            False
                                )
                                out
                            )
                    , \_ -> Expect.equal True (connectGateVisible next)
                    ]
                    ()
        , test "the account landing retires the gate" <|
            \_ ->
                let
                    asked =
                        step ConnectGateSubmit (withGate (\g -> { g | mode = ConnectGate.SignIn, name = "alice" }) { armed | runtimeOwnerStamp = Just stamp })

                    signed =
                        step ShellFocusSettled { asked | accountName = Just "alice" }
                in
                Expect.equal Nothing signed.connectGate
        , test "switching mode clears errors and moves focus to the first field" <|
            \_ ->
                let
                    ( next, out ) =
                        update (ConnectGateMode ConnectGate.SignIn) (withGate (\g -> { g | error = Just "x" }) armed)
                in
                Expect.equal ( Just ConnectGate.SignIn, Just Nothing, [ FocusElement "connect-name" ] )
                    ( Maybe.map .mode next.connectGate, Maybe.map .error next.connectGate, out )
        ]


registerPath : Test
registerPath =
    describe "create account"
        [ test "keeping the current name opens the guest-claim sheet (passwords stay runtime-owned)" <|
            \_ ->
                let
                    ( next, out ) =
                        update ConnectGateSubmit (withGate (\g -> { g | mode = ConnectGate.Register }) { armed | guestClaimDismissed = True })
                in
                Expect.equal ( True, Nothing, [] ) ( next.guestClaimOpen, next.connectGate, lines out )
        , test "a new name is confirmed first, then the sheet opens" <|
            \_ ->
                let
                    asked =
                        step ConnectGateSubmit (withGate (\g -> { g | mode = ConnectGate.Register, name = "kai" }) armed)

                    confirmed =
                        feed asked ":guest42!u@h NICK kai"
                in
                Expect.equal ( False, True, Nothing ) ( asked.guestClaimOpen, confirmed.guestClaimOpen, confirmed.connectGate )
        ]


viewSuite : Test
viewSuite =
    describe "View.Connect"
        [ test "the gate replaces the shell on /app" <|
            \_ ->
                let
                    q =
                        render armed
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.attribute (Attr.attribute "data-testid" "connect") ] q
                    , \_ -> Query.hasNot [ Selector.class "onyx-shell" ] q
                    , \_ -> Query.has [ Selector.text "Join Onyx" ] q
                    ]
                    ()
        , test "the status line is a polite live region" <|
            \_ ->
                render armed
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "connect-status") ]
                    |> Query.has [ Selector.attribute (Attr.attribute "role" "status"), Selector.attribute (Attr.attribute "aria-live" "polite") ]
        , test "submit is disabled until the socket is live" <|
            \_ ->
                render { armed | connection = Registering }
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "connect-submit") ]
                    |> Query.has [ Selector.disabled True, Selector.text "Connecting…" ]
        , test "the sign-in password is DOM-owned: the runtime id, no value binding" <|
            \_ ->
                render (withGate (\g -> { g | mode = ConnectGate.SignIn }) armed)
                    |> Query.find [ Selector.id "connection-password" ]
                    |> Query.has
                        [ Selector.attribute (Attr.type_ "password")
                        , Selector.attribute (Attr.attribute "autocomplete" "current-password")
                        ]
        , test "create account renders no password field" <|
            \_ ->
                render (withGate (\g -> { g | mode = ConnectGate.Register }) armed)
                    |> Query.findAll [ Selector.attribute (Attr.type_ "password") ]
                    |> Query.count (Expect.equal 0)
        , test "every field has a label and a described hint" <|
            \_ ->
                render armed
                    |> Query.find [ Selector.id "connect-name" ]
                    |> Query.has [ Selector.attribute (Attr.attribute "aria-describedby" "connect-name-hint") ]
        , test "the other modes are offered and dispatch" <|
            \_ ->
                render armed
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "connect-mode-signin") ]
                    |> Event.simulate Event.click
                    |> Event.expect (ConnectGateMode ConnectGate.SignIn)
        , test "offline offers a reconnect" <|
            \_ ->
                render { armed | connection = Offline }
                    |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Reconnect now" ] ]
                    |> Event.simulate Event.click
                    |> Event.expect ReconnectNow
        , test "a refusal renders as an alert" <|
            \_ ->
                render { armed | connectionDialogError = Just "That chat name is already in use. Try another name." }
                    |> Query.find [ Selector.attribute (Attr.attribute "role" "alert") ]
                    |> Query.has [ Selector.text "already in use" ]
        , test "the skip control is always reachable" <|
            \_ ->
                render { armed | connection = Offline }
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "connect-skip") ]
                    |> Event.simulate Event.click
                    |> Event.expect ConnectGateSkip
        , test "the room channel set is untouched by rendering" <|
            \_ -> Expect.equal Dict.empty armed.channels
        ]


pureSuite : Test
pureSuite =
    describe "ConnectGate"
        [ test "rooms normalize: blank, bare, prefixed, refused" <|
            \_ ->
                Expect.equal
                    [ Ok Nothing, Ok (Just "#lounge"), Ok (Just "&ops"), Err () ]
                    (List.map (ConnectGate.normalizeRoom >> Result.mapError (always ()))
                        [ "  ", "lounge", "&ops", "a,b" ]
                    )
        , test "submit copy follows mode and phase" <|
            \_ ->
                Expect.equal
                    [ "Join", "Sign in", "Continue", "Connecting…", "Signing in…", "Waiting for confirmation…" ]
                    [ ConnectGate.submitLabel ConnectGate.Guest ConnectGate.Ready
                    , ConnectGate.submitLabel ConnectGate.SignIn ConnectGate.Ready
                    , ConnectGate.submitLabel ConnectGate.Register ConnectGate.Ready
                    , ConnectGate.submitLabel ConnectGate.Guest ConnectGate.Connecting
                    , ConnectGate.submitLabel ConnectGate.SignIn ConnectGate.Waiting
                    , ConnectGate.submitLabel ConnectGate.Guest ConnectGate.Waiting
                    ]
        , test "phase: busy wins, then live, then connecting, else unreachable" <|
            \_ ->
                Expect.equal
                    [ ConnectGate.Waiting, ConnectGate.Ready, ConnectGate.Connecting, ConnectGate.Unreachable ]
                    [ ConnectGate.phase { live = True, registering = False, busy = True }
                    , ConnectGate.phase { live = True, registering = False, busy = False }
                    , ConnectGate.phase { live = False, registering = True, busy = False }
                    , ConnectGate.phase { live = False, registering = False, busy = False }
                    ]
        , test "status copy never names a server" <|
            \_ ->
                Expect.equal False
                    (List.any (String.contains "irc")
                        [ ConnectGate.statusLine ConnectGate.Guest ConnectGate.Unreachable 5
                        , ConnectGate.statusLine ConnectGate.SignIn ConnectGate.Connecting 0
                        ]
                    )
        ]
