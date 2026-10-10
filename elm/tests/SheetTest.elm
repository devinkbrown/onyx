module SheetTest exposing (suite)

{-| v3/ui-sheets — the sheet primitive's phone affordances and the
shared head: swipe-down-to-dismiss (decoded from the layer's own
scroll event), the grab handle + swipe spacer (light-dismiss sheets
only, never pinned ones), the full head (kicker / title / subtitle /
actions / icon close), and the inbox mounted as a popover sheet.
-}

import App exposing (Model, Msg(..), blank)
import Expect
import Html
import Html.Attributes as Attr
import Json.Decode as Decode
import Json.Encode as Encode
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View
import View.Sheet as Sheet


scrollEvent : String -> Float -> Float -> Float -> Encode.Value
scrollEvent cls top height client =
    Encode.object
        [ ( "target"
          , Encode.object
                [ ( "className", Encode.string cls )
                , ( "scrollTop", Encode.float top )
                , ( "scrollHeight", Encode.float height )
                , ( "clientHeight", Encode.float client )
                ]
          )
        ]


swipe : Encode.Value -> Result Decode.Error String
swipe =
    Decode.decodeValue (Sheet.swipeDismissDecoder "closed")


demo : Bool -> Query.Single String
demo pinned =
    let
        base =
            Sheet.config { scope = "demo", onClose = "closed" }

        render =
            if pinned then
                Sheet.viewPinned

            else
                Sheet.view
    in
    render base
        [ Sheet.headerWith
            (Sheet.head { scope = "demo", title = "Demo", closeLabel = "Close demo", onClose = "closed" }
                |> (\h ->
                        { h
                            | kicker = Just "Kicker"
                            , subtitle = Just "Sub copy"
                            , subtitleId = Just "demo-sub"
                            , actions = [ Html.button [] [ Html.text "Act" ] ]
                            , closeAttrs = [ Attr.attribute "data-onyx-autofocus" "demo" ]
                        }
                   )
            )
        ]
        |> Query.fromHtml


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


suite : Test
suite =
    describe "View.Sheet (v3/ui-sheets)"
        [ describe "swipe-down-to-dismiss"
            [ test "a layer scrolled the whole panel out of view closes" <|
                \_ -> Expect.equal (Ok "closed") (swipe (scrollEvent "onyx-sheet-layer x" -733 1577 844))
            , test "sub-pixel short of the end still closes" <|
                \_ -> Expect.equal (Ok "closed") (swipe (scrollEvent "onyx-sheet-layer" -731.5 1577 844))
            , test "a partial drag (snapping back) does not close" <|
                \_ -> Expect.err (swipe (scrollEvent "onyx-sheet-layer" -300 1577 844))
            , test "the open position does not close" <|
                \_ -> Expect.err (swipe (scrollEvent "onyx-sheet-layer" 0 1577 844))
            , test "a top-down scroller at its end (positive scrollTop) never closes" <|
                \_ -> Expect.err (swipe (scrollEvent "onyx-sheet-layer" 733 1577 844))
            , test "another element's scroll never closes" <|
                \_ -> Expect.err (swipe (scrollEvent "notify-panel onyx-sheet" -733 1577 844))
            , test "a layer with nothing to scroll (desktop) never closes" <|
                \_ -> Expect.err (swipe (scrollEvent "onyx-sheet-layer" -10 900 900))
            , test "the layer's scroll event is wired to onClose" <|
                \_ ->
                    -- The query root is the layer itself.
                    demo False
                        |> Event.simulate (Event.custom "scroll" (scrollEvent "onyx-sheet-layer" -600 1444 844))
                        |> Event.expect "closed"
            ]
        , describe "grab handle + spacer"
            [ test "light-dismiss sheets carry the grip and the swipe spacer" <|
                \_ ->
                    Expect.all
                        [ Query.has [ Selector.attribute (Attr.attribute "data-swipe" "true") ]
                        , Query.find [ Selector.class "onyx-sheet-grip" ] >> Query.has [ Selector.attribute (Attr.attribute "aria-hidden" "true") ]
                        , Query.find [ Selector.class "onyx-sheet-spacer" ] >> Query.has [ Selector.attribute (Attr.attribute "aria-hidden" "true") ]
                        ]
                        (demo False)
            , test "pinned sheets never swipe away" <|
                \_ ->
                    Expect.all
                        [ Query.has [ Selector.attribute (Attr.attribute "data-swipe" "false") ]
                        , Query.findAll [ Selector.class "onyx-sheet-grip" ] >> Query.count (Expect.equal 0)
                        , Query.findAll [ Selector.class "onyx-sheet-spacer" ] >> Query.count (Expect.equal 0)
                        ]
                        (demo True)
            ]
        , describe "the full head"
            [ test "kicker, titled h2, subtitle id, actions and an icon-only close" <|
                \_ ->
                    Expect.all
                        [ Query.find [ Selector.class "onyx-sheet-kicker" ] >> Query.has [ Selector.text "Kicker" ]
                        , Query.find [ Selector.id (Sheet.titleId "demo") ] >> Query.has [ Selector.tag "h2", Selector.text "Demo" ]
                        , Query.find [ Selector.id "demo-sub" ] >> Query.has [ Selector.text "Sub copy" ]
                        , Query.find [ Selector.class "onyx-sheet-head-actions" ] >> Query.has [ Selector.text "Act" ]
                        , Query.find [ Selector.attribute (Attr.attribute "aria-label" "Close demo") ]
                            >> Query.has
                                [ Selector.attribute (Attr.attribute "data-onyx-autofocus" "demo")
                                , Selector.containing [ Selector.class "onyx-sheet-x" ]
                                ]
                        , Query.find [ Selector.attribute (Attr.attribute "aria-label" "Close demo") ]
                            >> Event.simulate Event.click
                            >> Event.expect "closed"
                        ]
                        (demo False)
            ]
        , describe "inbox as a popover sheet"
            [ test "the open inbox mounts as a scoped popover dialog" <|
                \_ ->
                    query { blank | showNotificationCenter = True }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-shortcut-scope" "inbox") ]
                        |> Query.has
                            [ Selector.attribute (Attr.attribute "role" "dialog")
                            , Selector.attribute (Attr.attribute "aria-label" "Notification inbox")
                            , Selector.attribute (Attr.attribute "data-testid" "inbox-panel")
                            , Selector.text "Inbox"
                            , Selector.text "Mark all read"
                            ]
            , test "the popover's veil and close both close it" <|
                \_ ->
                    Expect.all
                        [ Query.find [ Selector.attribute (Attr.attribute "data-testid" "inbox-backdrop") ]
                            >> Event.simulate Event.click
                            >> Event.expect NotificationCenterClosed
                        , Query.find [ Selector.attribute (Attr.attribute "aria-label" "Close inbox") ]
                            >> Event.simulate Event.click
                            >> Event.expect NotificationCenterClosed
                        ]
                        (query { blank | showNotificationCenter = True })
            , test "the layer is placed as a popover" <|
                \_ ->
                    query { blank | showNotificationCenter = True }
                        |> Query.find [ Selector.class "notif-center-layer" ]
                        |> Query.has [ Selector.attribute (Attr.attribute "data-placement" "popover") ]
            ]
        ]
