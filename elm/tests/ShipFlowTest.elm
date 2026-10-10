module ShipFlowTest exposing (suite)

{-| v3 ship-bar flows (roadmap 0.6 / 7.4, partial): connect → Home →
open room → send → DM → settings → appearance, driven keyboard-only
through avh4/elm-program-test against the real `App.init` /
`App.update` / `View.view` with simulated ports.

Effects are simulated the way `Main.perform` performs them: `SendLine`
→ the `wsSend` port, `WsConnect` → `wsConnect`, `PushUrl` → simulated
navigation (feeding `App.UrlChanged`); every other `App.Outbound` is
logged on a synthetic `outbound` port by constructor name so a flow can
assert that a persistence / apply intention fired. Inbound socket
traffic arrives on the real port names (`wsOpened`, `wsLines`) and
global keys on `shortcut` (ports.js `classifyShortcut` names).

"Keyboard-only" here means every step is one a keyboard user can take:
activating a native, enabled, tabbable `<button>` (Enter/Space fire
click), submitting a form (Enter in a text field), arrow/Enter keydown
on a combobox or radio, or a global chord delivered through the
`shortcut` port. Each button activation first asserts the control is a
real `<button>` that is not disabled and not removed from the tab order.

Pending a real browser (no runnable Chromium on this musl host): focus
movement itself (sheet autofocus + restore lives in ports.js
`installOverlayFocus`, covered by overlayFocus.smoke.mjs), the 375 /
768 / 1280 layouts, and screenshots. The real compiled bundle is booted
through the same path by bundleBoot.smoke.mjs (jsdom).

-}

import App
import Expect
import Html.Attributes as Attr
import Json.Decode as Decode
import Json.Encode as Encode
import ProgramTest exposing (ProgramTest)
import SimulatedEffect.Cmd
import SimulatedEffect.Navigation
import SimulatedEffect.Ports
import SimulatedEffect.Sub
import Switcher
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector exposing (Selector)
import View


type alias Flow =
    ProgramTest App.Model App.Msg (List App.Outbound)


pin : String
pin =
    "wss://irc.onyx.test/ws"



-- HARNESS


{-| Boot like `Main.init` without `?nick=`: the connect gate is armed
and `?ws=` pins the endpoint (so submit dials directly, no probe). -}
start : Flow
start =
    ProgramTest.createApplication
        { init =
            \() url () ->
                let
                    base =
                        App.init "guest" url
                in
                ( { base | connectGate = True, wsPin = Just pin, nowMs = 1760000000000 }, [] )
        , view = View.view
        , update = App.update
        , onUrlRequest = App.LinkClicked
        , onUrlChange = App.UrlChanged
        }
        |> ProgramTest.withBaseUrl "https://onyx.test/app"
        |> ProgramTest.withSimulatedEffects simulateEffects
        |> ProgramTest.withSimulatedSubscriptions simulateSubscriptions
        |> ProgramTest.start ()


simulateEffects : List App.Outbound -> ProgramTest.SimulatedEffect App.Msg
simulateEffects outs =
    SimulatedEffect.Cmd.batch (List.map simulateOne outs)


simulateOne : App.Outbound -> ProgramTest.SimulatedEffect App.Msg
simulateOne out =
    case out of
        App.SendLine line ->
            -- ports.js frames one CRLF per command; compare bare commands.
            SimulatedEffect.Ports.send "wsSend" (Encode.string (String.replace "\r\n" "" line))

        App.WsConnect { url } ->
            SimulatedEffect.Ports.send "wsConnect" (Encode.object [ ( "url", Encode.string url ) ])

        App.PushUrl path ->
            SimulatedEffect.Navigation.pushUrl path

        other ->
            SimulatedEffect.Ports.send "outbound" (Encode.string (outboundName other))


{-| The constructor name of an outbound intention (`Debug.toString` is
fine in tests; they are never built with --optimize). -}
outboundName : App.Outbound -> String
outboundName out =
    Debug.toString out
        |> String.words
        |> List.head
        |> Maybe.withDefault ""


simulateSubscriptions : App.Model -> ProgramTest.SimulatedSub App.Msg
simulateSubscriptions _ =
    SimulatedEffect.Sub.batch
        [ SimulatedEffect.Ports.subscribe "wsOpened"
            (Decode.map (\url -> { url = url }) (Decode.field "url" Decode.string))
            App.WsOpened
        , SimulatedEffect.Ports.subscribe "wsLines"
            (Decode.map2 (\at lines -> { at = at, lines = lines })
                (Decode.field "at" Decode.int)
                (Decode.field "lines" (Decode.list Decode.string))
            )
            App.WsBatchReceived
        , SimulatedEffect.Ports.subscribe "shortcut"
            Decode.string
            (\name -> App.ShortcutPressed (Switcher.shortcutFromString name))
        ]


{-| The server says these lines (one socket message, `\r\n`-split). -}
serverSays : List String -> Flow -> Flow
serverSays lines =
    ProgramTest.simulateIncomingPort "wsLines"
        (Encode.object
            [ ( "at", Encode.int 1760000000000 )
            , ( "lines", Encode.list Encode.string lines )
            ]
        )


{-| A global chord as ports.js classifies it (e.g. Ctrl+K →
`palette-toggle`, Escape → `escape`). -}
chord : String -> Flow -> Flow
chord name =
    ProgramTest.simulateIncomingPort "shortcut" (Encode.string name)


testId : String -> Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


ariaLabel : String -> Selector
ariaLabel label =
    Selector.attribute (Attr.attribute "aria-label" label)


attr : String -> String -> Selector
attr name value =
    Selector.attribute (Attr.attribute name value)


{-| Keyboard reachability: exactly one enabled native `<button>` that
is not pulled out of the tab order. -}
ensureKeyboardButton : List Selector -> Flow -> Flow
ensureKeyboardButton selectors =
    ProgramTest.ensureView
        (Query.find (Selector.tag "button" :: selectors)
            >> Expect.all
                [ Query.hasNot [ Selector.disabled True ]
                , Query.hasNot [ Selector.attribute (Attr.tabindex -1) ]
                ]
        )


{-| Enter/Space on a focused button fires its click. -}
pressButton : List Selector -> Flow -> Flow
pressButton selectors flow =
    flow
        |> ensureKeyboardButton selectors
        |> ProgramTest.simulateDomEvent (Query.find (Selector.tag "button" :: selectors)) ( "click", Encode.object [] )


{-| Enter in a text field submits its form (implicit submission). -}
pressEnterInForm : List Selector -> Flow -> Flow
pressEnterInForm formSelectors =
    ProgramTest.simulateDomEvent (Query.find (Selector.tag "form" :: formSelectors)) ( "submit", Encode.object [] )


{-| A keydown on a control that owns its keys (combobox / radio). -}
keyDown : List Selector -> String -> Flow -> Flow
keyDown selectors key =
    ProgramTest.simulateDomEvent (Query.find selectors)
        ( "keydown"
        , Encode.object
            [ ( "key", Encode.string key )
            , ( "isComposing", Encode.bool False )
            , ( "keyCode", Encode.int 0 )
            , ( "shiftKey", Encode.bool False )
            , ( "altKey", Encode.bool False )
            , ( "ctrlKey", Encode.bool False )
            , ( "metaKey", Encode.bool False )
            ]
        )


sent : (List String -> Expect.Expectation) -> Flow -> Flow
sent check =
    ProgramTest.ensureOutgoingPortValues "wsSend" Decode.string check


sentLine : String -> Flow -> Flow
sentLine line =
    sent
        (\lines ->
            List.member line lines
                |> Expect.equal True
                |> Expect.onFail ("expected wsSend " ++ line ++ " in " ++ String.join " | " lines)
        )


intended : String -> Flow -> Flow
intended name =
    ProgramTest.ensureOutgoingPortValues "outbound"
        Decode.string
        (\names ->
            List.member name names
                |> Expect.equal True
                |> Expect.onFail ("expected outbound " ++ name ++ " in " ++ String.join ", " names)
        )


{-| The IRC command part of a sent line (drops any `@tags `). -}
untagged : String -> String
untagged line =
    if String.startsWith "@" line then
        String.words line |> List.drop 1 |> String.join " "

    else
        line



-- FLOW STEPS


{-| Gate → Enter → dial → registration → welcome → Home. -}
connectAsKai : Flow -> Flow
connectAsKai flow =
    flow
        |> ProgramTest.ensureViewHas [ testId "connect" ]
        |> ProgramTest.ensureView (Query.find [ Selector.id "conn-nick" ] >> Query.has [ Selector.tag "input" ])
        |> ProgramTest.ensureViewHas [ Selector.tag "label", Selector.attribute (Attr.for "conn-nick") ]
        |> ProgramTest.ensureOutgoingPortValues "wsConnect" Decode.value (Expect.equal [])
        |> ProgramTest.fillIn "conn-nick" "Display name" "kai"
        |> pressEnterInForm [ ariaLabel "Connect form" ]
        |> ProgramTest.ensureOutgoingPortValues "wsConnect" (Decode.field "url" Decode.string) (Expect.equal [ pin ])
        |> ProgramTest.ensureViewHas [ testId "conn-status", attr "aria-live" "polite" ]
        |> ProgramTest.ensureViewHas [ testId "conn-cancel" ]
        |> ProgramTest.simulateIncomingPort "wsOpened" (Encode.object [ ( "url", Encode.string pin ) ])
        |> sent (List.take 3 >> Expect.equal [ "CAP LS 302", "NICK kai", "USER webchat 0 * :kai (webchat)" ])
        |> serverSays
            [ ":onyx.test CAP * LS :message-tags server-time echo-message"
            , ":onyx.test 001 kai :Welcome to Onyx kai"
            , ":onyx.test 376 kai :End of MOTD"
            ]
        |> sentLine "CAP REQ :message-tags server-time echo-message"
        |> ProgramTest.ensureViewHasNot [ testId "connect" ]


{-| Browse rooms (button) → LIST → Join #lounge → server admits. -}
joinLounge : Flow -> Flow
joinLounge flow =
    flow
        |> ProgramTest.within (Query.find [ ariaLabel "Room navigation" ])
            (pressButton [ testId "sidebar-browse-rooms" ])
        |> sentLine "LIST"
        |> serverSays
            [ ":onyx.test 321 kai Channel :Users Name"
            , ":onyx.test 322 kai #lounge 4 :hang out"
            , ":onyx.test 323 kai :End of /LIST"
            ]
        |> pressButton [ ariaLabel "Join #lounge" ]
        |> sentLine "JOIN #lounge"
        |> serverSays
            [ ":kai!u@onyx.test JOIN #lounge"
            , ":onyx.test 353 kai = #lounge :kai alice"
            , ":onyx.test 366 kai #lounge :End of /NAMES list."
            ]
        |> ProgramTest.ensureViewHas [ Selector.tag "button", ariaLabel "Open #lounge" ]


{-| Ctrl+K → type → Enter (the palette's combobox owns Enter). -}
paletteGo : String -> Flow -> Flow
paletteGo query flow =
    flow
        |> chord "palette-toggle"
        |> ProgramTest.ensureView
            (Query.find [ testId "command-palette" ]
                >> Query.has [ attr "role" "dialog", attr "aria-modal" "true" ]
            )
        |> ProgramTest.ensureView
            (Query.find [ Selector.id "onyx-spotlight-input" ]
                >> Query.has [ attr "role" "combobox", attr "data-onyx-autofocus" "palette" ]
            )
        |> ProgramTest.fillIn "onyx-spotlight-input" "Command search" query
        |> keyDown [ Selector.id "onyx-spotlight-input" ] "Enter"
        |> ProgramTest.ensureViewHasNot [ testId "command-palette" ]


composerIs : String -> Flow -> Flow
composerIs target =
    ProgramTest.ensureView
        (Query.find [ Selector.class "onyx-composer-target" ] >> Query.has [ Selector.text target ])


sendInComposer : String -> Flow -> Flow
sendInComposer body flow =
    flow
        |> ProgramTest.fillIn "shell-composer-input" "Message" body
        |> pressEnterInForm [ Selector.class "onyx-composer" ]


textSize : Query.Single App.Msg -> Query.Single App.Msg
textSize =
    Query.find [ attr "role" "radiogroup", ariaLabel "Text size" ]



-- SUITE


suite : Test
suite =
    describe "v3 ship bar flows (keyboard-only, simulated ports)"
        [ test "connect: gate → Enter dials the pinned endpoint → welcome lands on Home" <|
            \() ->
                start
                    |> connectAsKai
                    |> ProgramTest.ensureViewHas [ testId "home", ariaLabel "Home" ]
                    -- Desktop rail + mobile bar (CSS shows one per breakpoint):
                    -- both mark Home as the current location.
                    |> ProgramTest.ensureView
                        (Query.findAll [ testId "nav-home" ]
                            >> Expect.all
                                [ Query.count (Expect.equal 2)
                                , Query.each (Query.has [ Selector.tag "button", attr "aria-current" "page" ])
                                ]
                        )
                    |> ProgramTest.ensureViewHas [ Selector.tag "nav", ariaLabel "Primary" ]
                    |> ProgramTest.ensureViewHas [ Selector.tag "nav", ariaLabel "Mobile navigation" ]
                    |> ProgramTest.expectBrowserUrl (Expect.equal "https://onyx.test/app")
        , test "open room: browse → join → Ctrl+K palette → Enter opens #lounge" <|
            \() ->
                start
                    |> connectAsKai
                    |> joinLounge
                    |> paletteGo "lounge"
                    |> composerIs "#lounge"
                    |> ProgramTest.ensureViewHas [ testId "room-header" ]
                    |> ProgramTest.expectViewHas [ attr "role" "log" ]
        , test "send: Enter in the composer sends PRIVMSG and the echo lands in the log" <|
            \() ->
                start
                    |> connectAsKai
                    |> joinLounge
                    |> paletteGo "lounge"
                    |> sendInComposer "hello onyx"
                    |> sent
                        (List.map untagged
                            >> List.filter (String.startsWith "PRIVMSG #lounge")
                            >> Expect.equal [ "PRIVMSG #lounge :hello onyx" ]
                        )
                    |> ProgramTest.ensureView
                        (Query.find [ Selector.id "shell-composer-input" ]
                            >> Query.has [ Selector.attribute (Attr.value "") ]
                        )
                    |> serverSays [ ":kai!u@onyx.test PRIVMSG #lounge :hello onyx" ]
                    |> ProgramTest.expectView
                        (Query.find [ attr "role" "log" ]
                            >> Query.has [ Selector.text "hello onyx" ]
                        )
        , test "DM: an inbound DM lists under Messages; New conversation → Enter opens and sends" <|
            \() ->
                start
                    |> connectAsKai
                    |> serverSays [ ":alice!a@onyx.test PRIVMSG kai :psst" ]
                    |> ProgramTest.ensureView (Query.find [ testId "sidebar-dms" ] >> Query.has [ Selector.text "alice" ])
                    |> pressButton [ testId "new-conversation" ]
                    |> ProgramTest.ensureViewHas [ attr "role" "dialog" ]
                    |> ProgramTest.fillIn "new-message-recipient" "Who do you want to message?" "alice"
                    |> pressEnterInForm [ Selector.containing [ Selector.id "new-message-recipient" ] ]
                    |> composerIs "alice"
                    -- The peer key lookup answers "no key" before the send.
                    |> serverSays [ ":onyx.test 766 kai alice ocean.dm-key :key not set" ]
                    |> sendInComposer "hi alice"
                    |> ProgramTest.expectOutgoingPortValues "wsSend"
                        Decode.string
                        (\lines ->
                            List.member "PRIVMSG alice :hi alice" (List.map untagged lines)
                                |> Expect.equal True
                                |> Expect.onFail ("expected a PRIVMSG to alice in " ++ String.join " | " lines)
                        )
        , test "settings: You (button) → Preferences sheet → toggle a switch → Escape closes" <|
            \() ->
                start
                    |> connectAsKai
                    |> pressButton [ testId "you-open" ]
                    |> ProgramTest.ensureView
                        (Query.find [ testId "you-hub" ] >> Query.has [ attr "role" "dialog" ])
                    |> pressButton [ testId "you-settings-open-preferences" ]
                    |> ProgramTest.ensureView
                        (Query.find [ testId "preferences-panel" ]
                            >> Query.has [ attr "role" "dialog", attr "aria-modal" "true" ]
                        )
                    -- Category tabs use a roving tabindex: only the
                    -- selected tab is tabbable; arrows move selection.
                    |> ProgramTest.ensureView
                        (Query.find [ attr "role" "tab", attr "aria-selected" "true" ]
                            >> Expect.all
                                [ Query.has [ ariaLabel "Display", Selector.attribute (Attr.tabindex 0) ]
                                ]
                        )
                    |> keyDown [ attr "role" "tab", attr "aria-selected" "true" ] "ArrowRight"
                    |> ProgramTest.ensureView
                        (Query.find [ attr "role" "tab", attr "aria-selected" "true" ]
                            >> Query.has [ ariaLabel "Conversation", Selector.attribute (Attr.tabindex 0) ]
                        )
                    |> ProgramTest.ensureView
                        (Query.find [ testId "pref-toggle-hideEvents" ]
                            >> Query.has [ attr "role" "switch", attr "aria-checked" "false" ]
                        )
                    |> pressButton [ testId "pref-toggle-hideEvents" ]
                    |> ProgramTest.ensureView
                        (Query.find [ testId "pref-toggle-hideEvents" ] >> Query.has [ attr "aria-checked" "true" ])
                    |> intended "AppearanceStorePrefs"
                    |> chord "escape"
                    |> ProgramTest.expectViewHasNot [ testId "preferences-panel" ]
        , test "appearance: Preferences → Open appearance → arrow keys move Text size" <|
            \() ->
                start
                    |> connectAsKai
                    |> pressButton [ testId "you-open" ]
                    |> pressButton [ testId "you-settings-open-preferences" ]
                    |> pressButton [ testId "pref-open-appearance" ]
                    |> ProgramTest.ensureBrowserUrl (Expect.equal "https://onyx.test/appearance")
                    |> ProgramTest.ensureViewHasNot [ testId "preferences-panel" ]
                    |> ProgramTest.ensureView
                        (textSize
                            >> Query.find [ attr "aria-checked" "true" ]
                            >> Expect.all
                                [ Query.has [ Selector.text "Medium" ]
                                , Query.has [ Selector.attribute (Attr.tabindex 0) ]
                                ]
                        )
                    |> ProgramTest.within textSize
                        (keyDown [ attr "aria-checked" "true" ] "ArrowRight")
                    |> ProgramTest.ensureView
                        (textSize
                            >> Query.find [ attr "aria-checked" "true" ]
                            >> Query.has [ Selector.text "Large" ]
                        )
                    |> intended "AppearanceApply"
                    |> ProgramTest.expectViewHas [ attr "role" "radiogroup", ariaLabel "Look" ]
        ]
