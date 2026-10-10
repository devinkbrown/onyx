module PublicUiTest exposing (suite)

{-| v3/ui-public: the first impression — cold-load URL state, the
connect gate door, the public frame chrome, the landing, the invite
card, and the download disclosure.
-}

import App exposing (..)
import Expect
import Html
import Html.Attributes as Attr
import Route
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Url
import View


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


boot : String -> Model
boot raw =
    case Url.fromString raw of
        Just url ->
            App.init "guest" url

        Nothing ->
            blank


gate : Model -> Model
gate model =
    { model | route = Route.App, connectGate = True, connection = Offline, autoReconnect = False }


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


suite : Test
suite =
    describe "public UI"
        [ describe "cold load"
            [ test "an invite link names its room on first paint" <|
                \_ ->
                    let
                        model =
                            boot "https://onyx.example/invite?join=%23root&as=kai"
                    in
                    Expect.all
                        [ \m -> Expect.equal (Just "#root") (inviteCard m).channel
                        , \m -> Expect.equal "kai" m.inviteName
                        , \m -> Expect.equal "/invite" m.navPath
                        , \m ->
                            query m
                                |> Query.has [ Selector.text "Join #root" ]
                        , \m ->
                            query m
                                |> Query.hasNot [ Selector.text "This link does not name a room. Open Onyx and choose one there, or ask your friend for a new room invite." ]
                        ]
                        model
            , test "an invite's chosen name pre-fills the connect gate" <|
                \_ ->
                    let
                        model =
                            boot "https://onyx.example/app/?join=%23root&as=kai"
                    in
                    Expect.all
                        [ \m -> Expect.equal "kai" m.connectForm.nick
                        , \m -> Expect.equal (Just "#root") m.pendingDeepLinkJoin
                        , \m -> Expect.equal "" m.inviteName
                        ]
                        model
            , test "a hostile `as` never seeds the gate" <|
                \_ ->
                    (boot "https://onyx.example/app/?as=%20bad%20name%0A").connectForm.nick
                        |> Expect.equal ""
            , test "a roadmap fragment selects its priority on first paint" <|
                \_ ->
                    (boot "https://onyx.example/roadmap/#roadmap-next").roadmapPriority
                        |> Expect.equal (Just "next")
            ]
        , describe "connect gate"
            [ test "the guest door names a pending deep-link room" <|
                \_ ->
                    let
                        q =
                            query (gate { blank | pendingDeepLinkJoin = Just "#root" })
                    in
                    Expect.all
                        [ \_ -> Query.find [ Selector.tag "h1" ] q |> Query.has [ Selector.text "Join #root" ]
                        , \_ -> Query.has [ Selector.text "Optional — leave empty to join #root." ] q
                        , \_ ->
                            Query.find [ Selector.id "conn-room" ] q
                                |> Query.has [ Selector.attribute (Attr.placeholder "#root") ]
                        ]
                        ()
            , test "without a deep link the door keeps its plain copy" <|
                \_ ->
                    query (gate blank)
                        |> Query.find [ Selector.tag "h1" ]
                        |> Query.has [ Selector.text "Join a room" ]
            , test "a typed room wins over the deep link" <|
                \_ ->
                    let
                        form =
                            blankConnectForm
                    in
                    query (gate { blank | pendingDeepLinkJoin = Just "#root", connectForm = { form | room = "#design" } })
                        |> Query.find [ Selector.tag "h1" ]
                        |> Query.has [ Selector.text "Join a room" ]
            , test "the brand links home and the modes carry their test ids" <|
                \_ ->
                    let
                        q =
                            query (gate blank)
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.class "conn-brand" ] q
                                |> Query.has [ Selector.attribute (Attr.href "/") ]
                        , \_ ->
                            Query.find [ testId "conn-mode-signin" ] q
                                |> Event.simulate Event.click
                                |> Event.expect (ConnectModeSet ConnectSignIn)
                        , \_ ->
                            Query.find [ testId "conn-mode-register" ] q
                                |> Event.simulate Event.click
                                |> Event.expect (ConnectModeSet ConnectRegister)
                        , \_ -> Query.hasNot [ testId "conn-mode-guest" ] q
                        ]
                        ()
            , test "idle status stays in the live region but is visually quiet" <|
                \_ ->
                    query (gate blank)
                        |> Query.find [ testId "conn-status" ]
                        |> Expect.all
                            [ Query.has [ Selector.class "conn-status-idle" ]
                            , Query.has [ Selector.attribute (Attr.attribute "aria-live" "polite") ]
                            ]
            , test "register explains a disabled submit as soon as it can" <|
                \_ ->
                    let
                        form =
                            blankConnectForm

                        typed password confirm =
                            query (gate { blank | connectForm = { form | mode = ConnectRegister, nick = "kai", password = password, confirm = confirm } })
                    in
                    Expect.all
                        [ \_ -> typed "short" "" |> Query.has [ Selector.text "Use at least 8 characters." ]
                        , \_ -> typed "hunter22" "hunter2" |> Query.hasNot [ Selector.text "Passwords do not match." ]
                        , \_ -> typed "hunter22" "hunter23" |> Query.has [ Selector.text "Passwords do not match." ]
                        , \_ ->
                            typed "hunter22" "hunter23"
                                |> Query.find [ Selector.id "conn-confirm" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-invalid" "true") ]
                        ]
                        ()
            ]
        , describe "public frame"
            [ test "the brand mark is drawn, not fetched" <|
                \_ ->
                    query { blank | route = Route.Landing }
                        |> Query.find [ Selector.class "public-frame__header" ]
                        |> Expect.all
                            [ Query.has [ Selector.class "public-frame__mark" ]
                            , Query.findAll [ Selector.tag "img" ] >> Query.count (Expect.equal 0)
                            ]
            , test "the phone menu carries the secondary destinations" <|
                \_ ->
                    query { blank | route = Route.Status, navPath = "/status/" }
                        |> Query.find [ Selector.id "public-primary-navigation" ]
                        |> Expect.all
                            [ Query.has [ Selector.text "More from Onyx" ]
                            , Query.find [ Selector.tag "a", Selector.attribute (Attr.href "/status/") ]
                                >> Query.has [ Selector.attribute (Attr.attribute "aria-current" "page") ]
                            , Query.findAll [ Selector.tag "a" ] >> Query.count (Expect.equal 8)
                            ]
            , test "the footer reaches every public destination" <|
                \_ ->
                    query { blank | route = Route.Landing }
                        |> Query.find [ Selector.class "public-frame__footer-links" ]
                        |> Query.findAll [ Selector.tag "a" ]
                        |> Query.count (Expect.equal 9)
            ]
        , describe "landing"
            [ test "the room sketch is decorative and captioned" <|
                \_ ->
                    query { blank | route = Route.Landing }
                        |> Query.find [ Selector.class "onyx-land-sketch" ]
                        |> Expect.all
                            [ Query.has [ Selector.attribute (Attr.attribute "aria-hidden" "true") ]
                            , Query.has [ Selector.text "Illustration, not a live room." ]
                            ]
            , test "each trust claim carries its icon" <|
                \_ ->
                    query { blank | route = Route.Landing }
                        |> Query.findAll [ Selector.class "onyx-land-claim-icon" ]
                        |> Query.count (Expect.equal 4)
            ]
        , describe "invite"
            [ test "a bare room invite skips the redundant preview card" <|
                \_ ->
                    query (boot "https://onyx.example/invite?join=%23root")
                        |> Query.hasNot [ Selector.class "invite-preview" ]
            , test "an inviter or topic earns the preview card" <|
                \_ ->
                    query (boot "https://onyx.example/invite?join=%23root&by=mara&topic=Game%20night")
                        |> Query.find [ Selector.class "invite-preview" ]
                        |> Expect.all
                            [ Query.has [ Selector.text "mara invited you to #root on Onyx." ]
                            , Query.has [ Selector.text "Game night" ]
                            ]
            ]
        , describe "download"
            [ test "checksum and install steps sit behind a disclosure" <|
                \_ ->
                    query { blank | route = Route.Download }
                        |> Query.findAll [ Selector.tag "details", Selector.class "dl-more" ]
                        |> Query.count (Expect.equal 4)
            ]
        ]
