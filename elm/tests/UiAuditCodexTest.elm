module UiAuditCodexTest exposing (suite)

import App exposing (Model, Msg(..), Outbound(..), blank, update)
import Browser
import Expect
import Html
import Html.Attributes as Attr
import Nav
import Route
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Url
import View


render : Model -> Query.Single Msg
render model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


feed : String -> Model -> Model
feed line model =
    update (WsLineReceived line) model |> Tuple.first


roomModel : Model
roomModel =
    { blank | ourNick = "me", route = Route.App, navPath = "/app/", connectGate = Nothing }
        |> feed ":me!u@h JOIN #one"
        |> feed ":me!u@h JOIN #two"
        |> (\model -> update (ChannelSelect "#one") model |> Tuple.first)
        |> feed ":bob!u@h PRIVMSG #two :hello me"


withUrl : String -> (Url.Url -> Expect.Expectation) -> Expect.Expectation
withUrl address assertion =
    case Url.fromString address of
        Just url -> assertion url
        Nothing -> Expect.fail "Invalid fixture URL"


suite : Test
suite =
    describe "CODEX UI audit"
        [ test "rail mention badges include an @ prefix" <|
            \_ ->
                render roomModel
                    |> Query.find [ Selector.class "onyx-rail-mention" ]
                    |> Query.has [ Selector.text "@1" ]
        , test "connection control starts with its visible state" <|
            \_ ->
                render { roomModel | connection = App.Live }
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "connection-open") ]
                    |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Connected, connection settings"), Selector.text "Connected" ]
        , test "navigation counts unread conversations" <|
            \_ ->
                render roomModel
                    |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "nav-rooms") ]
                    |> Query.first
                    |> Query.has [ Selector.text "1 conversation with unread" ]
        , test "every shell main is a skip target" <|
            \_ ->
                [ roomModel, { roomModel | navSection = Nav.Home }, { roomModel | callsOpen = True } ]
                    |> List.map (\model -> \_ -> render model |> Query.find [ Selector.id "onyx-main" ] |> Query.has [ Selector.tag "main", Selector.attribute (Attr.tabindex -1) ])
                    |> (\checks -> Expect.all checks ())
        , test "shell skip link points to the main" <|
            \_ -> render roomModel |> Query.find [ Selector.class "site-skip" ] |> Query.has [ Selector.attribute (Attr.href "#onyx-main"), Selector.text "Skip to content" ]
        , test "same-page fragment click focuses the target once, via UrlChanged" <|
            \_ -> withUrl "https://example.com/about/#site-main" <|
                \url ->
                    let
                        ( clicked, clickOut ) =
                            update (LinkClicked (Browser.Internal url)) { blank | navPath = "/about/" }

                        ( settled, changeOut ) =
                            update (UrlChanged url) clicked
                    in
                    Expect.equal ( [ PushUrl "https://example.com/about/#site-main" ], 1, False )
                        ( clickOut, changeOut |> List.filter ((==) (FocusElement "site-main")) |> List.length, settled.navFocusPending )
        , test "URL fragments focus decoded in-page targets" <|
            \_ -> withUrl "https://example.com/stats/#network%2Doverview" <|
                \url -> update (UrlChanged url) { blank | navFocusPending = True } |> Tuple.second |> List.member (FocusElement "network-overview") |> Expect.equal True
        , test "public path changes focus main, query-only changes do not" <|
            \_ -> withUrl "https://example.com/about/?topic=rooms" <|
                \url ->
                    Expect.equal ( True, False )
                        ( update (UrlChanged url) { blank | navPath = "/", navFocusPending = True } |> Tuple.second |> List.member (FocusElement "site-main")
                        , update (UrlChanged url) { blank | navPath = "/about/", navFocusPending = True } |> Tuple.second |> List.member (FocusElement "site-main")
                        )
        , test "browser back/forward (popstate) leaves focus and scroll alone" <|
            \_ ->
                Expect.all
                    [ \_ -> withUrl "https://example.com/about/" <|
                        \url -> update (UrlChanged url) { blank | navPath = "/" } |> Tuple.second |> List.filter (\out -> out == FocusElement "site-main") |> Expect.equal []
                    , \_ -> withUrl "https://example.com/roadmap/#roadmap-next" <|
                        \url -> update (UrlChanged url) { blank | navPath = "/" } |> Tuple.second |> List.member (FocusElement "roadmap-next") |> Expect.equal False
                    , \_ -> withUrl "https://example.com/appearance/" <|
                        \url -> update (UrlChanged url) { blank | navPath = "/" } |> Tuple.second |> List.member (FocusElement "ap-title") |> Expect.equal False
                    ]
                    ()
        , test "Escape restores the public menu toggle only when open" <|
            \_ -> Expect.equal ( [ FocusElement "public-menu-toggle" ], [] )
                ( update NavMenuEscape { blank | navMenuOpen = True } |> Tuple.second
                , update NavMenuEscape blank |> Tuple.second
                )
        , test "Landing has the shared stateful menu and one announcer" <|
            \_ -> render { blank | route = Route.Landing, navMenuOpen = True }
                |> Query.find [ Selector.id "public-menu-toggle" ]
                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Navigation menu"), Selector.attribute (Attr.attribute "aria-expanded" "true") ]
        , test "announcer uses the page heading" <|
            \_ -> render { blank | route = Route.About }
                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "route-announcer") ]
                |> Query.has [ Selector.text "Rooms for people you already like." ]
        , test "Guides and Community announce distinct text" <|
            \_ ->
                let
                    announced route =
                        render { blank | route = route } |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "route-announcer") ]
                in
                Expect.all
                    [ \_ -> announced Route.Guides |> Query.has [ Selector.text "Guides — getting started" ]
                    , \_ -> announced Route.Community |> Query.has [ Selector.text "Community — getting started" ]
                    ]
                    ()
        , test "Stats has one feed status and focusable section targets" <|
            \_ ->
                Expect.all
                    [ \_ -> render { blank | route = Route.Stats } |> Query.findAll [ Selector.class "stats-page" ] |> Query.first |> Query.findAll [ Selector.attribute (Attr.attribute "role" "status") ] |> Query.count (Expect.equal 1)
                    , \_ -> render { blank | route = Route.Stats } |> Query.find [ Selector.id "network-overview" ] |> Query.has [ Selector.attribute (Attr.tabindex -1) ]
                    ] ()
        ]
