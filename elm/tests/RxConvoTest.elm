module RxConvoTest exposing (suite)

{-| v3/rx-convo — the conversation surface at every aspect ratio:
the local edit-history view (roadmap 2.9), the lightbox zoom state,
the non-modal thread pane, block-aware message text, and pinned
items with faces. Rendering + update only; layout lives in CSS.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode
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


room : Model
room =
    { blank | ourNick = "me", caps = [ "draft/message-editing" ], nowMs = 1000 }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":alice!u@h JOIN #c")
        |> (\m -> feed m "@msgid=m9 :me!u@h PRIVMSG #c :projector")
        |> (\m -> feed m "@msgid=a1 :alice!u@h PRIVMSG #c :hello world")
        |> step (ChannelSelect "#c")


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


suite : Test
suite =
    describe "v3/rx-convo"
        [ describe "local edit history (roadmap 2.9)"
            [ test "our edited row opens the earlier versions kept on this device" <|
                \_ ->
                    let
                        edited =
                            room
                                |> step (MessageEditRequested "#c" "m9" "projector and cable")
                                |> step (MessageEditRequested "#c" "m9" "projector, cable and adapter")

                        history =
                            query edited
                                |> Query.find [ Selector.tag "details", Selector.class "onyx-edited--history" ]
                    in
                    Expect.all
                        [ \_ ->
                            history
                                |> Query.find [ Selector.tag "summary" ]
                                |> Query.has
                                    [ Selector.class "onyx-edited-toggle"
                                    , Selector.text "· edited"
                                    , Selector.attribute (Attr.attribute "aria-label" "Edited. Show 2 earlier versions saved on this device")
                                    ]
                        , \_ ->
                            history
                                |> Query.find [ Selector.attribute (Attr.attribute "role" "region") ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Local edit history") ]
                        , \_ ->
                            history
                                |> Query.findAll [ Selector.class "onyx-edit-history-item" ]
                                |> Query.count (Expect.equal 2)
                        , \_ ->
                            history
                                |> Query.findAll [ Selector.class "onyx-edit-history-body" ]
                                |> Query.first
                                |> Query.has [ Selector.text "projector" ]
                        , \_ ->
                            history
                                |> Query.findAll [ Selector.class "onyx-edit-history-body" ]
                                |> Query.index 1
                                |> Query.has [ Selector.text "projector and cable" ]
                        ]
                        ()
            , test "one revision reads in the singular" <|
                \_ ->
                    room
                        |> step (MessageEditRequested "#c" "m9" "projector!")
                        |> query
                        |> Query.find [ Selector.class "onyx-edited-toggle" ]
                        |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Edited. Show 1 earlier version saved on this device") ]
            , test "someone else's edit keeps the quiet label (no local history)" <|
                \_ ->
                    let
                        theirs =
                            feed room ":alice!u@h EDIT #c a1 :hello edited"
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.class "onyx-edited", Selector.text "· edited" ] (query theirs)
                        , \_ -> Query.hasNot [ Selector.class "onyx-edited--history" ] (query theirs)
                        ]
                        ()
            , test "a withdrawn row never shows its history" <|
                \_ ->
                    room
                        |> step (MessageEditRequested "#c" "m9" "projector!")
                        |> (\m -> feed m ":me!u@h REDACT #c m9")
                        |> query
                        |> Query.hasNot [ Selector.class "onyx-edited--history" ]
            ]
        , describe "lightbox"
            [ test "zoom toggles fit / full size and resets on every open" <|
                \_ ->
                    let
                        opened =
                            step (MediaLightboxOpen "https://app.example.test/a.png") room

                        zoomed =
                            step (MediaLightboxZoom True) opened

                        reopened =
                            zoomed
                                |> step MediaLightboxClose
                                |> step (MediaLightboxOpen "https://app.example.test/a.png")
                    in
                    Expect.all
                        [ \_ ->
                            query opened
                                |> Query.find [ Selector.class "shell-msg-lightbox" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "data-zoomed" "false") ]
                        , \_ ->
                            query opened
                                |> Query.find [ Selector.class "shell-msg-lightbox-zoom" ]
                                |> Event.simulate Event.click
                                |> Event.expect (MediaLightboxZoom True)
                        , \_ ->
                            query zoomed
                                |> Query.find [ Selector.class "shell-msg-lightbox-zoom" ]
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "aria-pressed" "true")
                                    , Selector.attribute (Attr.attribute "aria-label" "Fit to screen")
                                    ]
                        , \_ ->
                            query zoomed
                                |> Query.find [ Selector.class "shell-msg-lightbox-img" ]
                                |> Event.simulate (Event.custom "dblclick" (Json.Encode.object []))
                                |> Event.expect (MediaLightboxZoom False)
                        , \_ -> Expect.equal False reopened.mediaLightboxZoomed
                        , \_ -> Expect.equal False (step (MediaLightboxZoom True) room).mediaLightboxZoomed
                        ]
                        ()
            , test "a swipe that carries the picture off screen closes it (touch layer)" <|
                \_ ->
                    let
                        opened =
                            step (MediaLightboxOpen "https://app.example.test/a.png") room

                        scrolled top =
                            Event.custom "scroll"
                                (Json.Encode.object
                                    [ ( "target"
                                      , Json.Encode.object
                                            [ ( "className", Json.Encode.string "shell-msg-lightbox" )
                                            , ( "scrollTop", Json.Encode.float top )
                                            , ( "scrollHeight", Json.Encode.float 1688 )
                                            , ( "clientHeight", Json.Encode.float 844 )
                                            ]
                                      )
                                    ]
                                )

                        layer =
                            query opened |> Query.find [ Selector.class "shell-msg-lightbox" ]
                    in
                    Expect.all
                        [ \_ -> layer |> Event.simulate (scrolled -844) |> Event.expect MediaLightboxClose
                        , \_ ->
                            layer
                                |> Event.simulate (scrolled -300)
                                |> Event.toResult
                                |> Expect.err
                        , \_ ->
                            layer
                                |> Event.simulate (scrolled 0)
                                |> Event.toResult
                                |> Expect.err
                        ]
                        ()
            , test "the surround closes it; the picture does not" <|
                \_ ->
                    let
                        opened =
                            step (MediaLightboxOpen "https://app.example.test/a.png") room
                    in
                    Expect.all
                        [ \_ ->
                            query opened
                                |> Query.find [ Selector.class "shell-msg-lightbox-stage" ]
                                |> Event.simulate Event.click
                                |> Event.expect MediaLightboxClose
                        , \_ ->
                            query opened
                                |> Query.find [ Selector.class "shell-msg-lightbox-dialog" ]
                                |> Event.simulate (Event.custom "keydown" (Json.Encode.object [ ( "key", Json.Encode.string "Escape" ), ( "isComposing", Json.Encode.bool False ) ]))
                                |> Event.expect MediaLightboxClose
                        ]
                        ()
            ]
        , test "the thread pane is a non-modal dialog (it docks beside the transcript)" <|
            \_ ->
                let
                    threaded =
                        room
                            |> (\m -> feed m "@msgid=r1;+draft/reply=a1 :bob!u@h PRIVMSG #c :a reply")

                    parentId =
                        threaded.channels
                            |> Dict.get "#c"
                            |> Maybe.map (.messages >> List.filter (\m -> m.msgid == Just "a1") >> List.map .id)
                            |> Maybe.andThen List.head
                            |> Maybe.withDefault -1
                in
                threaded
                    |> step (ThreadOpen { channel = "#c", parentId = parentId })
                    |> query
                    |> Query.find [ Selector.class "onyx-thread-sheet" ]
                    |> Query.has
                        [ Selector.attribute (Attr.attribute "role" "dialog")
                        , Selector.attribute (Attr.attribute "aria-modal" "false")
                        , Selector.text "a reply"
                        ]
        , test "a quote is not followed by an empty line" <|
            \_ ->
                feed room "@msgid=q1 :alice!u@h PRIVMSG #c :> quoting the old thread\nyes, it wraps"
                    |> query
                    |> Query.find [ Selector.class "shell-msg-text", Selector.containing [ Selector.tag "blockquote" ] ]
                    |> Query.findAll [ Selector.tag "br" ]
                    |> Query.count (Expect.equal 0)
        , test "pinned items carry the author's face" <|
            \_ ->
                room
                    |> (\m -> feed m ":alice!u@h PROP #c PINS :a1")
                    |> step PinnedMessagesOpen
                    |> query
                    |> Query.find [ Selector.class "pins-item" ]
                    |> Query.has [ Selector.class "pins-item-face", Selector.text "hello world" ]
        ]
