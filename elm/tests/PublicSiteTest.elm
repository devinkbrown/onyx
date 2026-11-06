module PublicSiteTest exposing (suite)

{-| Public website chrome and landing contracts: the shared masthead
(stateful frame menu and stateless landing disclosure), the footer that
reaches every public page, the route announcer, and the landing's
decorative-only room sketch.
-}

import App exposing (Model, Msg(..), blank, update)
import Expect
import Html
import Html.Attributes as Attr
import Route
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View
import View.PublicFrame exposing (footerLinks, moreNav, primaryNav, trustLinks)


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


suite : Test
suite =
    describe "public site"
        [ describe "landing"
            [ test "keeps the authoritative title" <|
                \_ ->
                    View.view { blank | route = Route.Landing }
                        |> .title
                        |> Expect.equal "Onyx — good company. Great nights."
            , test "one labelled main with the display heading" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Landing }
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.findAll [ Selector.tag "main" ]
                                |> Query.count (Expect.equal 1)
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "main" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Onyx home"), Selector.id "site-main" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "Rooms, DMs, and calls", Selector.text "for your people." ]
                        , \_ -> Query.has [ Selector.text "Skip to content" ] q
                        ]
                        ()
            , test "every product picture is a real screenshot with alt text, WebP first" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Landing }
                    in
                    Expect.all
                        [ \_ -> q |> Query.findAll [ Selector.class "site-shot-img" ] |> Query.count (Expect.atLeast 4)
                        , \_ -> q |> Query.findAll [ Selector.tag "source", Selector.attribute (Attr.attribute "type" "image/webp") ] |> Query.count (Expect.atLeast 4)
                        , \_ -> q |> Query.hasNot [ Selector.attribute (Attr.src "/brand/mascot-still.png") ]
                        , \_ -> q |> Query.hasNot [ Selector.class "site-sketch" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "site-hero" ]
                                |> Query.findAll [ Selector.tag "img", Selector.attribute (Attr.attribute "loading" "eager") ]
                                |> Query.count (Expect.atLeast 1)
                        ]
                        ()
            , test "one primary call to action in the hero goes to the app" <|
                \_ ->
                    query { blank | route = Route.Landing }
                        |> Query.find [ Selector.class "site-hero" ]
                        |> Query.findAll [ Selector.class "site-cta-primary" ]
                        |> Expect.all
                            [ Query.count (Expect.equal 1)
                            , Query.first >> Query.has [ Selector.attribute (Attr.href "/app/"), Selector.text "Open Onyx" ]
                            ]
            , test "the page never claims group rooms are end-to-end encrypted" <|
                \_ ->
                    query { blank | route = Route.Landing }
                        |> Query.find [ Selector.class "site-trust" ]
                        |> Query.has [ Selector.text "Encrypted rooms seal messages between enrolled devices (new; security review pending)." ]
            , test "stateless masthead offers a native phone menu with every destination" <|
                \_ ->
                    let
                        menu =
                            query { blank | route = Route.Landing }
                                |> Query.find [ Selector.class "site-menu-details" ]
                    in
                    Expect.all
                        [ \_ -> menu |> Query.has [ Selector.tag "details" ]
                        , \_ ->
                            menu
                                |> Query.find [ Selector.tag "summary" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Navigation menu") ]
                        , \_ ->
                            menu
                                |> Query.findAll [ Selector.tag "a" ]
                                |> Query.count (Expect.equal (List.length primaryNav + List.length moreNav))
                        ]
                        ()
            , test "feature icons are hidden from assistive tech" <|
                \_ ->
                    query { blank | route = Route.Landing }
                        |> Query.findAll [ Selector.class "site-icon", Selector.attribute (Attr.attribute "aria-hidden" "true") ]
                        |> Query.count (Expect.equal 10)
            , test "landing footer explores the site" <|
                \_ ->
                    query { blank | route = Route.Landing }
                        |> Query.find [ Selector.tag "footer" ]
                        |> Query.has [ Selector.text "Explore Onyx", Selector.text "Trust and help", Selector.text "Source on GitHub" ]
            ]
        , describe "frame"
            [ test "footer reaches every product and trust page" <|
                \_ ->
                    query { blank | route = Route.About, navPath = "/about/" }
                        |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Footer navigation") ]
                        |> Query.findAll [ Selector.tag "a" ]
                        |> Query.count (Expect.equal (List.length footerLinks + List.length trustLinks))
            , test "current page is marked in the masthead and footer" <|
                \_ ->
                    query { blank | route = Route.About, navPath = "/about/" }
                        |> Query.findAll [ Selector.tag "a", Selector.attribute (Attr.attribute "aria-current" "page"), Selector.containing [ Selector.text "About" ] ]
                        |> Query.count (Expect.equal 2)
            , test "route announcer speaks the page label" <|
                \_ ->
                    query { blank | route = Route.Status }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "route-announcer") ]
                        |> Query.has
                            [ Selector.attribute (Attr.attribute "aria-live" "polite")
                            , Selector.text "Onyx network status"
                            ]
            , test "main is a focus target for the skip link" <|
                \_ ->
                    query { blank | route = Route.Status }
                        |> Query.find [ Selector.id "site-main" ]
                        |> Query.has [ Selector.attribute (Attr.tabindex -1) ]
            , test "phone menu carries the secondary destinations only when opened" <|
                \_ ->
                    let
                        opened =
                            Tuple.first (update ToggleNavMenu { blank | route = Route.Status })
                    in
                    Expect.all
                        [ \_ ->
                            query opened
                                |> Query.find [ Selector.id "public-primary-navigation" ]
                                |> Query.has [ Selector.class "is-open", Selector.text "More from Onyx", Selector.text "House rules" ]
                        , \_ ->
                            query opened
                                |> Query.find [ Selector.class "site-menu-toggle" ]
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "aria-expanded" "true")
                                    , Selector.attribute (Attr.attribute "aria-label" "Close navigation menu")
                                    ]
                        , \_ ->
                            query opened
                                |> Query.find [ Selector.class "site-menu-toggle" ]
                                |> Event.simulate Event.click
                                |> Event.expect ToggleNavMenu
                        ]
                        ()
            , test "404 keeps the terminus copy inside the frame" <|
                \_ ->
                    query { blank | route = Route.NotFound, navPath = "/nope" }
                        |> Query.find [ Selector.tag "main" ]
                        |> Query.has [ Selector.text "Route terminus", Selector.attribute (Attr.attribute "aria-label" "Onyx page not found") ]
            ]
        , describe "appearance page"
            [ test "one h1, no duplicate title in the bar, and real controls back and home" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Appearance }
                    in
                    Expect.all
                        [ \_ -> q |> Query.findAll [ Selector.tag "h1" ] |> Query.count (Expect.equal 1)
                        , \_ -> q |> Query.find [ Selector.tag "h1" ] |> Query.has [ Selector.text "Appearance" ]
                        , \_ -> q |> Query.find [ Selector.class "ap-bar" ] |> Query.hasNot [ Selector.text "Appearance" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "ap-back" ]
                                |> Query.has [ Selector.attribute (Attr.href "/app/"), Selector.text "Back to app" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "ap-home" ]
                                |> Query.has [ Selector.attribute (Attr.href "/"), Selector.attribute (Attr.attribute "aria-label" "Onyx home") ]
                        ]
                        ()
            , test "choice rows are single-select radio groups with one checked option" <|
                \_ ->
                    query { blank | route = Route.Appearance }
                        |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Text size") ]
                        |> Expect.all
                            [ Query.has [ Selector.class "ap-chips--choices", Selector.attribute (Attr.attribute "role" "radiogroup") ]
                            , Query.findAll [ Selector.attribute (Attr.attribute "aria-checked" "true") ] >> Query.count (Expect.equal 1)
                            , Query.findAll [ Selector.attribute (Attr.attribute "role" "radio") ] >> Query.count (Expect.equal 3)
                            ]
            , test "privacy rows keep label, description and the switch state as separate parts" <|
                \_ ->
                    query { blank | route = Route.Appearance }
                        |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Preview web links") ]
                        |> Expect.all
                            [ Query.has [ Selector.class "ap-choice-toggle", Selector.attribute (Attr.attribute "role" "switch") ]
                            , Query.find [ Selector.tag "small" ] >> Query.has [ Selector.text "Show link details fetched through this server." ]
                            , Query.find [ Selector.tag "b" ] >> Query.has [ Selector.text "On" ]
                            ]
            ]
        ]
