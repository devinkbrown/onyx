module RxPublicNavTest exposing (suite)

{-| v3/rx-public — public navigation parity: route entry on a cold load
(download catalog / status / stats share links), scroll + focus on page
changes and `#fragment` links (skip link, section navs), static files as
document loads, `/app` deep-link params on in-app navigation, `?signin=1`,
roving board tabs, focus follow-through, the route announcer, and the
"Sign in as X" door.
-}

import App exposing (..)
import Browser
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


urlOf : String -> Url.Url
urlOf raw =
    Url.fromString raw
        |> Maybe.withDefault { protocol = Url.Https, host = "onyx.example", port_ = Nothing, path = "/", query = Nothing, fragment = Nothing }


boot : String -> Model
boot raw =
    App.init "guest" (urlOf raw)


navigate : String -> Model -> ( Model, List Outbound )
navigate raw model =
    update (UrlChanged (urlOf raw)) model


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


isFetch : String -> Outbound -> Bool
isFetch key out =
    case out of
        HttpFetch req ->
            req.key == key

        _ ->
            False


suite : Test
suite =
    describe "public navigation"
        [ describe "route entry on a cold load"
            [ test "/download fetches the catalog without waiting for a navigation" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (RouteEntered (urlOf "https://onyx.example/download/")) (boot "https://onyx.example/download/")
                    in
                    Expect.all
                        [ \_ -> List.any (isFetch "download-catalog") out |> Expect.equal True
                        , \_ -> m.downloadCatalogLoading |> Expect.equal True
                        ]
                        ()
            , test "a stats share link seeds room, compare and window on a hard load" <|
                \_ ->
                    let
                        raw =
                            "https://onyx.example/stats/?room=%23lounge&compare=%23root,%23design&window=7"

                        ( m, _ ) =
                            update (RouteEntered (urlOf raw)) (boot raw)
                    in
                    Expect.all
                        [ \_ -> m.statsInspected |> Expect.equal "#lounge"
                        , \_ -> List.length m.statsCompare |> Expect.equal 2
                        ]
                        ()
            , test "a hard-loaded #fragment is scrolled to and focused" <|
                \_ ->
                    update (RouteEntered (urlOf "https://onyx.example/roadmap/#roadmap-next")) (boot "https://onyx.example/roadmap/#roadmap-next")
                        |> Tuple.second
                        |> List.member (PageNavigated { fragment = "roadmap-next" })
                        |> Expect.equal True
            , test "the app route never asks for page scroll" <|
                \_ ->
                    update (RouteEntered (urlOf "https://onyx.example/app/#x")) (boot "https://onyx.example/app/#x")
                        |> Tuple.second
                        |> Expect.equal []
            ]
        , describe "page changes"
            [ test "a new public page starts at the top" <|
                \_ ->
                    navigate "https://onyx.example/privacy/" (boot "https://onyx.example/")
                        |> Tuple.second
                        |> List.member (PageNavigated { fragment = "" })
                        |> Expect.equal True
            , test "the skip link and section anchors focus their target" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            navigate "https://onyx.example/about/#public-main" (boot "https://onyx.example/about/")
                                |> Tuple.second
                                |> Expect.equal [ PageNavigated { fragment = "public-main" } ]
                        , \_ ->
                            navigate "https://onyx.example/about/#hosting" (boot "https://onyx.example/")
                                |> Tuple.second
                                |> List.member (PageNavigated { fragment = "hosting" })
                                |> Expect.equal True
                        ]
                        ()
            , test "navigating into /app leaves the shell's scroll alone" <|
                \_ ->
                    navigate "https://onyx.example/app/" (boot "https://onyx.example/")
                        |> Tuple.second
                        |> List.any (\o -> o == PageNavigated { fragment = "" })
                        |> Expect.equal False
            , test "same-origin files load as documents, routes push" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            update (LinkClicked (Browser.Internal (urlOf "https://onyx.example/downloads/onyx-linux.NOTICE.txt"))) blank
                                |> Tuple.second
                                |> Expect.equal [ LoadUrl "https://onyx.example/downloads/onyx-linux.NOTICE.txt" ]
                        , \_ ->
                            update (LinkClicked (Browser.Internal (urlOf "https://onyx.example/source/onyxos/onyx.c"))) blank
                                |> Tuple.second
                                |> Expect.equal [ LoadUrl "https://onyx.example/source/onyxos/onyx.c" ]
                        , \_ ->
                            update (LinkClicked (Browser.Internal (urlOf "https://onyx.example/stats/"))) blank
                                |> Tuple.second
                                |> Expect.equal [ PushUrl "https://onyx.example/stats/" ]
                        ]
                        ()
            ]
        , describe "/app params"
            [ test "an in-app link into /app honours join, as and signin" <|
                \_ ->
                    let
                        ( m, _ ) =
                            navigate "https://onyx.example/app/?join=%23root&as=kai&signin=1" (boot "https://onyx.example/invite/?join=%23root")
                    in
                    Expect.all
                        [ \_ -> m.pendingDeepLinkJoin |> Expect.equal (Just "#root")
                        , \_ -> m.connectForm.nick |> Expect.equal "kai"
                        , \_ -> m.connectForm.mode |> Expect.equal ConnectSignIn
                        ]
                        ()
            , test "?signin=1 opens Sign in on a cold load; garbage does not" <|
                \_ ->
                    Expect.all
                        [ \_ -> (boot "https://onyx.example/app/?signin=1").connectForm.mode |> Expect.equal ConnectSignIn
                        , \_ -> (boot "https://onyx.example/app/?signin=yes").connectForm.mode |> Expect.equal ConnectGuest
                        ]
                        ()
            , test "a live session ignores arriving params" <|
                \_ ->
                    let
                        live =
                            boot "https://onyx.example/about/"

                        ( m, _ ) =
                            navigate "https://onyx.example/app/?join=%23root&signin=1" { live | connection = Live }
                    in
                    Expect.all
                        [ \_ -> m.pendingDeepLinkJoin |> Expect.equal Nothing
                        , \_ -> m.connectForm.mode |> Expect.equal ConnectGuest
                        ]
                        ()
            ]
        , describe "focus follow-through"
            [ test "board tabs rove with the arrow keys and take focus" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (BoardTabKey { key = "ArrowRight" }) blank
                    in
                    Expect.all
                        [ \_ -> m.landingBoardTab |> Expect.equal "bring-people"
                        , \_ -> out |> Expect.equal [ PrefsFocus { id = "board-tab-bring-people" } ]
                        , \_ -> (Tuple.first (update (BoardTabKey { key = "End" }) blank)).landingBoardTab |> Expect.equal "learn"
                        , \_ -> (Tuple.first (update (BoardTabKey { key = "ArrowLeft" }) blank)).landingBoardTab |> Expect.equal "learn"
                        ]
                        ()
            , test "the board tabs carry roving tabindex and name their panel" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Landing }
                    in
                    Expect.all
                        [ \_ -> Query.find [ Selector.id "board-tab-public-room" ] q |> Query.has [ Selector.attribute (Attr.tabindex 0), Selector.attribute (Attr.attribute "aria-controls" "board-panel") ]
                        , \_ -> Query.find [ Selector.id "board-tab-learn" ] q |> Query.has [ Selector.attribute (Attr.tabindex -1) ]
                        , \_ -> Query.find [ Selector.id "board-panel" ] q |> Query.has [ Selector.attribute (Attr.attribute "aria-labelledby" "board-tab-public-room") ]
                        ]
                        ()
            , test "OnyxOS method tabs move focus with the selection" <|
                \_ ->
                    update (OnyxosStageKey { key = "ArrowRight" }) blank
                        |> Tuple.second
                        |> Expect.equal [ PrefsFocus { id = "onyxos-method-tab-implementation" } ]
            , test "an invalid invite name returns focus to the field" <|
                \_ ->
                    update InviteJoinSubmit { blank | inviteName = "bad name" }
                        |> Tuple.second
                        |> Expect.equal [ PrefsFocus { id = "invite-display-name" } ]
            , test "public pages carry a polite route announcer naming the page" <|
                \_ ->
                    query { blank | route = Route.Privacy }
                        |> Query.find [ testId "route-announcer" ]
                        |> Query.has [ Selector.attribute (Attr.attribute "role" "status"), Selector.text "Onyx privacy" ]
            ]
        , describe "Sign in as X"
            [ test "the door opens fresh on the same name with focus on the password" <|
                \_ ->
                    let
                        failed =
                            { blank | connectGate = True, route = Route.App, connection = Offline }
                                |> (\g -> { g | connectForm = { blankConnectForm | nick = "kai", attempted = True } })

                        ( m, out ) =
                            update ConnectSignInAs failed
                    in
                    Expect.all
                        [ \_ -> m.connectForm.mode |> Expect.equal ConnectSignIn
                        , \_ -> m.connectForm.nick |> Expect.equal "kai"
                        , \_ -> m.connectForm.attempted |> Expect.equal False
                        , \_ -> out |> Expect.equal [ PrefsFocus { id = "conn-password" } ]
                        ]
                        ()
            , test "a guest failure on a name in use offers it; an idle form does not" <|
                \_ ->
                    let
                        gate =
                            { blank | connectGate = True, route = Route.App, connection = Offline }

                        failed =
                            { gate | currentNickIsAlias = True, connectForm = { blankConnectForm | nick = "kai", attempted = True } }
                    in
                    Expect.all
                        [ \_ ->
                            query failed
                                |> Query.find [ testId "conn-signin-as" ]
                                |> Event.simulate Event.click
                                |> Event.expect ConnectSignInAs
                        , \_ -> query failed |> Query.find [ testId "conn-signin-as" ] |> Query.has [ Selector.text "Sign in as kai" ]
                        , \_ -> query gate |> Query.hasNot [ testId "conn-signin-offer" ]
                        ]
                        ()
            ]
        ]
