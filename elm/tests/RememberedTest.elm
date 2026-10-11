module RememberedTest exposing (suite)

{-| v3/rx-public — remembered identities and "Stay signed in" on the
join screen (roadmap 0.3), plus the invite preview aside (0.4).

The Elm side only ever sees sanitized metadata: these vectors pin the
fail-closed listing decoder, the select / act / forget flows (which
never carry a secret out — only an opaque id), the dial that follows a
`held` answer without re-sending SASL credentials, and the post-auth
`remember` step.
-}

import App exposing (..)
import Credentials exposing (RememberedIdentityAccess(..))
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as E
import Remembered
import Route
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Url
import View


armed : Model
armed =
    { blank | connectGate = True, route = Route.App, connection = Offline, autoReconnect = False }


entry : String -> String -> String -> Bool -> E.Value
entry id nick access active =
    E.object
        [ ( "id", E.string id )
        , ( "nick", E.string nick )
        , ( "server", E.string "irc.example" )
        , ( "savedAt", E.string "2026-10-09T20:00:00.000Z" )
        , ( "active", E.bool active )
        , ( "access", E.string access )
        ]


listing : E.Value
listing =
    E.list identity
        [ entry "saved-a1-b1" "kai" "resume" True
        , entry "saved-a2-b2" "Mara" "sign-in" False
        , entry "saved-a3-b3" "lee" "identity-only" False
        ]


listed : Model
listed =
    Tuple.first (update (RememberedListed listing) armed)


run : List Msg -> Model -> ( Model, List Outbound )
run msgs model =
    List.foldl
        (\msg ( m, outs ) ->
            let
                ( next, out ) =
                    update msg m
            in
            ( next, outs ++ out )
        )
        ( model, [] )
        msgs


request : String -> String -> Outbound
request op id =
    CredentialsRequest { op = op, id = id, server = "", nick = "", display = "", remember = False }


isSaslHandoff : Outbound -> Bool
isSaslHandoff out =
    case out of
        SaslCredentialsStored _ ->
            True

        _ ->
            False


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


suite : Test
suite =
    describe "remembered identities"
        [ describe "listing decoder (fail-closed)"
            [ test "valid entries decode in order with their access" <|
                \_ ->
                    Remembered.decodeListing listing
                        |> List.map (\i -> ( i.nick, i.access, i.active ))
                        |> Expect.equal [ ( "kai", ResumeAccess, True ), ( "Mara", SignInAccess, False ), ( "lee", IdentityOnlyAccess, False ) ]
            , test "junk entries drop; a non-list is empty" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Remembered.decodeListing
                                (E.list identity
                                    [ entry "saved-a1-b1" "bad nick" "resume" False
                                    , entry "not-an-id" "kai" "resume" False
                                    , entry "saved-a2-b2" "kai" "root" False
                                    , E.string "nope"
                                    , entry "saved-a3-b3" "ok" "sign-in" False
                                    ]
                                )
                                |> List.map .nick
                                |> Expect.equal [ "ok" ]
                        , \_ -> Remembered.decodeListing (E.object []) |> Expect.equal []
                        ]
                        ()
            , test "duplicates keep the first; one active at most; capped at 12" <|
                \_ ->
                    let
                        many =
                            List.range 1 20 |> List.map (\n -> entry ("saved-" ++ String.fromInt n ++ "-x") ("u" ++ String.fromInt n) "sign-in" True)

                        decoded =
                            Remembered.decodeListing (E.list identity (entry "saved-1-x" "first" "resume" False :: many))
                    in
                    Expect.all
                        [ \d -> List.length d |> Expect.equal 12
                        , \d -> List.head d |> Maybe.map .nick |> Expect.equal (Just "first")
                        , \d -> List.filter .active d |> List.length |> Expect.equal 1
                        ]
                        decoded
            , test "a listing never carries a secret field into the model" <|
                \_ ->
                    Remembered.decodeListing
                        (E.list identity
                            [ E.object
                                [ ( "id", E.string "saved-a1-b1" )
                                , ( "nick", E.string "kai" )
                                , ( "server", E.string "irc.example\u{0000}" )
                                , ( "access", E.string "sign-in" )
                                , ( "password", E.string "hunter22" )
                                ]
                            ]
                        )
                        |> List.map .server
                        |> Expect.equal [ "irc.example" ]
            ]
        , describe "flows"
            [ test "the first listing selects the active identity and never prefills the guest name" <|
                \_ ->
                    Expect.all
                        [ \m -> m.rememberedIds.selectedId |> Expect.equal (Just "saved-a1-b1")
                        , \m -> m.connectForm.nick |> Expect.equal ""
                        , \m -> m.connectForm.mode |> Expect.equal ConnectGuest
                        ]
                        listed
            , test "select prefills sign-in (no password), turns Stay signed in on, marks it active ports-side" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (RememberedSelect "saved-a2-b2") listed
                    in
                    Expect.all
                        [ \_ -> m.connectForm.mode |> Expect.equal ConnectSignIn
                        , \_ -> m.connectForm.nick |> Expect.equal "Mara"
                        , \_ -> m.connectForm.password |> Expect.equal ""
                        , \_ -> m.rememberedIds.stay |> Expect.equal True
                        , \_ -> out |> Expect.equal [ request "select" "saved-a2-b2" ]
                        ]
                        ()
            , test "Use identity (no stored secret) only prefills sign-in" <|
                \_ ->
                    let
                        ( m, out ) =
                            run [ RememberedSelect "saved-a3-b3", RememberedAct ] listed
                    in
                    Expect.all
                        [ \_ -> m.connectForm.mode |> Expect.equal ConnectSignIn
                        , \_ -> m.connectForm.nick |> Expect.equal "lee"
                        , \_ -> m.connectForm.dialing |> Expect.equal False
                        , \_ -> List.member (request "use" "saved-a3-b3") out |> Expect.equal False
                        ]
                        ()
            , test "Resume asks the ports to arm the stored password by id only" <|
                \_ ->
                    let
                        ( m, out ) =
                            update RememberedAct listed
                    in
                    Expect.all
                        [ \_ -> out |> Expect.equal [ request "use" "saved-a1-b1" ]
                        , \_ -> m.rememberedIds.using |> Expect.equal (Just "saved-a1-b1")
                        , \_ -> m.connectForm.dialing |> Expect.equal False
                        ]
                        ()
            , test "a held answer dials as a password sign-in without re-sending SASL credentials" <|
                \_ ->
                    let
                        ( m, out ) =
                            run [ RememberedAct, RememberedReady { id = "saved-a1-b1", nick = "kai", held = True } ] listed
                    in
                    Expect.all
                        [ \_ -> m.connectForm.dialing |> Expect.equal True
                        , \_ -> m.saslAccount |> Expect.equal (Just "kai")
                        , \_ -> m.saslPasswordHeld |> Expect.equal True
                        , \_ -> m.ourNick |> Expect.equal "kai"
                        , \_ -> m.rememberedIds.using |> Expect.equal Nothing
                        , \_ -> m.rememberedIds.pending |> Expect.equal (Just True)
                        , \_ -> List.any isSaslHandoff out |> Expect.equal False
                        ]
                        ()
            , test "a Resume with no stored password falls back to the prefilled sign-in form" <|
                \_ ->
                    let
                        ( m, _ ) =
                            run [ RememberedAct, RememberedReady { id = "saved-a1-b1", nick = "kai", held = False } ] listed
                    in
                    Expect.all
                        [ \_ -> m.connectForm.mode |> Expect.equal ConnectSignIn
                        , \_ -> m.connectForm.nick |> Expect.equal "kai"
                        , \_ -> m.connectForm.dialing |> Expect.equal False
                        , \_ -> m.saslPasswordHeld |> Expect.equal False
                        ]
                        ()
            , test "a stale or foreign ready answer is ignored" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (RememberedReady { id = "saved-a1-b1", nick = "kai", held = True }) listed
                    in
                    Expect.all
                        [ \_ -> m.connectForm.dialing |> Expect.equal False
                        , \_ -> out |> Expect.equal []
                        ]
                        ()
            , test "forget drops the identity optimistically and clears a matching prefill" <|
                \_ ->
                    let
                        ( m, out ) =
                            run [ RememberedSelect "saved-a2-b2", RememberedForget "saved-a2-b2" ] listed
                    in
                    Expect.all
                        [ \_ -> List.map .nick m.rememberedIds.identities |> Expect.equal [ "kai", "lee" ]
                        , \_ -> m.connectForm.nick |> Expect.equal ""
                        , \_ -> m.rememberedIds.selectedId |> Expect.equal (Just "saved-a1-b1")
                        , \_ -> List.member (request "forget" "saved-a2-b2") out |> Expect.equal True
                        ]
                        ()
            , test "a typed sign-in stages the switch; the accepted account sends remember" <|
                \_ ->
                    let
                        typed =
                            { armed | endpoint = Just "irc.example" }
                                |> (\m -> { m | connectForm = { blankConnectForm | mode = ConnectSignIn, nick = "Kai", password = "hunter22" } })

                        ( staged, _ ) =
                            run [ ConnectStaySignedIn True, ConnectSubmit ] typed

                        ( accepted, out ) =
                            update RememberedDismiss { staged | accountName = Just "Kai", connection = Live }
                    in
                    Expect.all
                        [ \_ -> staged.rememberedIds.pending |> Expect.equal (Just True)
                        , \_ ->
                            out
                                |> Expect.equal
                                    [ CredentialsRequest { op = "remember", id = "", server = "irc.example", nick = "kai", display = "Kai", remember = True } ]
                        , \_ -> accepted.rememberedIds.pending |> Expect.equal Nothing
                        ]
                        ()
            , test "with the switch off the accepted account opts out" <|
                \_ ->
                    let
                        typed =
                            { armed | endpoint = Just "irc.example" }
                                |> (\m -> { m | connectForm = { blankConnectForm | mode = ConnectSignIn, nick = "kai", password = "hunter22" } })

                        ( staged, _ ) =
                            update ConnectSubmit typed

                        ( _, out ) =
                            update RememberedDismiss { staged | accountName = Just "kai", connection = Live }
                    in
                    out
                        |> Expect.equal
                            [ CredentialsRequest { op = "remember", id = "", server = "irc.example", nick = "kai", display = "kai", remember = False } ]
            , test "a guest join never stages a remember; a close before the account drops one" <|
                \_ ->
                    let
                        guest =
                            { armed | connectForm = { blankConnectForm | nick = "kai" } }
                                |> (\m -> { m | rememberedIds = { blankRemembered | pending = Just True } })

                        ( joined, _ ) =
                            update ConnectSubmit guest

                        ( closed, _ ) =
                            update (WsClosed { clean = False, reason = "" }) { armed | rememberedIds = { blankRemembered | pending = Just True } }
                    in
                    Expect.all
                        [ \_ -> joined.rememberedIds.pending |> Expect.equal Nothing
                        , \_ -> closed.rememberedIds.pending |> Expect.equal Nothing
                        ]
                        ()
            ]
        , describe "join screen view"
            [ test "the panel lists identities and names its action; the form submit steps down" <|
                \_ ->
                    let
                        q =
                            query listed
                    in
                    Expect.all
                        [ \_ -> Query.find [ testId "conn-identities" ] q |> Query.has [ Selector.text "Continue where you left off" ]
                        , \_ -> Query.findAll [ Selector.class "conn-identity" ] q |> Query.count (Expect.equal 3)
                        , \_ -> Query.find [ testId "conn-resume" ] q |> Query.has [ Selector.text "Resume" ]
                        , \_ ->
                            Query.find [ testId "conn-resume" ] q
                                |> Event.simulate Event.click
                                |> Event.expect RememberedAct
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "aria-label" "Forget Mara") ] q
                                |> Event.simulate Event.click
                                |> Event.expect (RememberedForget "saved-a2-b2")
                        , \_ -> Query.find [ testId "conn-submit" ] q |> Query.has [ Selector.class "conn-submit--quiet" ]
                        , \_ -> Query.findAll [ Selector.tag "h1" ] q |> Query.count (Expect.equal 1)
                        , \_ -> Query.hasNot [ Selector.text "hunter22" ] q
                        ]
                        ()
            , test "Not now, a first attempt, and Create account all hide the panel" <|
                \_ ->
                    Expect.all
                        [ \_ -> query (Tuple.first (update RememberedDismiss listed)) |> Query.hasNot [ testId "conn-identities" ]
                        , \_ -> query { listed | connectForm = { blankConnectForm | attempted = True } } |> Query.hasNot [ testId "conn-identities" ]
                        , \_ -> query { listed | connectForm = { blankConnectForm | mode = ConnectRegister } } |> Query.hasNot [ testId "conn-identities" ]
                        ]
                        ()
            , test "Stay signed in shows on the password sign-in path only, off by default" <|
                \_ ->
                    let
                        signIn =
                            { armed | connectForm = { blankConnectForm | mode = ConnectSignIn } }
                    in
                    Expect.all
                        [ \_ ->
                            query signIn
                                |> Query.find [ Selector.id "conn-stay-signed-in" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "role" "switch"), Selector.attribute (Attr.attribute "aria-checked" "false") ]
                        , \_ ->
                            query signIn
                                |> Query.find [ Selector.id "conn-stay-signed-in" ]
                                |> Event.simulate (Event.check True)
                                |> Event.expect (ConnectStaySignedIn True)
                        , \_ -> query armed |> Query.hasNot [ Selector.id "conn-stay-signed-in" ]
                        , \_ ->
                            query { armed | connectForm = { blankConnectForm | mode = ConnectSignIn, recoveryOpen = True } }
                                |> Query.hasNot [ Selector.id "conn-stay-signed-in" ]
                        ]
                        ()
            , test "an invite link previews its room, inviter, topic, and company" <|
                \_ ->
                    let
                        model =
                            App.init "guest" (urlOf "https://onyx.example/app/?join=%23game-night&by=mara&topic=Game%20night%20at%209pm&with=jun,iris")
                                |> (\m -> { m | connectGate = True, connection = Offline })

                        preview =
                            query model |> Query.find [ testId "conn-invite" ]
                    in
                    Expect.all
                        [ \_ -> query model |> Query.find [ Selector.tag "h1" ] |> Query.has [ Selector.text "Join #game-night" ]
                        , \_ -> preview |> Query.has [ Selector.text "mara invited you to #game-night on Onyx." ]
                        , \_ -> preview |> Query.has [ Selector.text "Game night at 9pm" ]
                        , \_ -> preview |> Query.has [ Selector.text "With jun, iris" ]
                        , \_ -> preview |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Invite preview") ]
                        ]
                        ()
            , test "a typed room hides the invite preview; a bare deep link names the room only" <|
                \_ ->
                    let
                        deep =
                            { armed | pendingDeepLinkJoin = Just "#root" }
                    in
                    Expect.all
                        [ \_ -> query { deep | connectForm = { blankConnectForm | room = "#design" } } |> Query.hasNot [ testId "conn-invite" ]
                        , \_ -> query deep |> Query.find [ testId "conn-invite" ] |> Query.has [ Selector.text "You were sent a link to #root on Onyx." ]
                        ]
                        ()
            ]
        ]


blankRemembered : Remembered.State
blankRemembered =
    Remembered.blank


urlOf : String -> Url.Url
urlOf raw =
    Url.fromString raw |> Maybe.withDefault fallbackUrl


fallbackUrl : Url.Url
fallbackUrl =
    { protocol = Url.Https, host = "onyx.example", port_ = Nothing, path = "/app/", query = Nothing, fragment = Nothing }
