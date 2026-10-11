module CallsRxTest exposing (suite)

{-| v3/rx-calls — calls polish and gaps:

  - device-key enrollment no longer waits for `ACCOUNTRESIDENCE` (the
    server never advertises it at sign-in): the welcome burst end
    (376 / 422) enrolls a signed-in account's key node-lessly;
  - guests get "Sign in to join calls" instead of a join that fails;
    DMs say direct calls aren't available yet;
  - a join shows "Connecting…" at once, and Leave cancels it;
  - media failures become calm toasts (never silent);
  - the stage head carries the call facts; the toolbar is controls
    only; More closes on tap-outside and offers the room invite.

-}

import App exposing (..)
import Attribution
import CallDock
import CallUi
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Media exposing (CallLifecycle(..), CallOutcome(..))
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


member : String -> App.Member
member nick =
    { nick = nick, modes = Set.empty, away = False }


harbor : App.Channel
harbor =
    { name = "#harbor"
    , topic = ""
    , members = Dict.fromList [ ( "mara", member "mara" ), ( "jun", member "jun" ), ( "odalys", member "odalys" ) ]
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


guest : Model
guest =
    { blank
        | ourNick = "odalys"
        , channels = Dict.fromList [ ( "#harbor", harbor ) ]
        , activeChannel = Just "#harbor"
        , nowMs = 1000
    }


signedIn : Model
signedIn =
    { guest | accountName = Just "odalys" }


withVoice : List String -> Model -> Model
withVoice roster model =
    let
        media0 =
            model.media
    in
    { model | media = { media0 | participants = Dict.fromList [ ( "#harbor", roster ) ] } }


inCall : Model
inCall =
    withVoice [ "odalys", "mara", "jun" ]
        { signedIn | calls = { lifecycle = InCall, channel = Just "#harbor", withPeer = "", startedAt = Just 1000, outcome = Nothing }, nowMs = 61000 }


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


feed : Model -> String -> ( Model, List Outbound )
feed model line =
    update (WsLineReceived line) model


owner : Model
owner =
    { blank | endpoint = Just "wss://irc.example", ourNick = "kai" }


enrolls : List Outbound -> List { serverUrl : String, account : String, nodeHex : String, gen : Int }
enrolls outs =
    List.filterMap
        (\o ->
            case o of
                AttributionEnrollRequest req ->
                    Just req

                _ ->
                    Nothing
        )
        outs


sendLines : List Outbound -> List String
sendLines outs =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    Just line

                _ ->
                    Nothing
        )
        outs


snapshot : List ( String, Encode.Value ) -> Msg
snapshot fields =
    CallHubSnapshot (Encode.object fields)


suite : Test
suite =
    describe "v3/rx-calls"
        [ enrollment
        , guests
        , provisional
        , mediaErrors
        , stageAnatomy
        ]



-- DEVICE KEY ENROLLMENT WITHOUT ACCOUNTRESIDENCE


enrollment : Test
enrollment =
    describe "device key enrollment without ACCOUNTRESIDENCE"
        [ test "a signed-in account enrolls node-lessly when the welcome burst ends (376)" <|
            \_ ->
                let
                    ( logged, early ) =
                        feed owner ":irc.example 900 kai kai!u@h alice :You are now logged in as alice"

                    ( supported, _ ) =
                        feed logged ":s 005 kai CHANTYPES=# :are supported"

                    ( done, out ) =
                        feed supported ":irc.example 376 kai :End of /MOTD command."
                in
                Expect.all
                    [ \_ -> Expect.equal [] (enrolls early)
                    , \_ -> Expect.equal [ { serverUrl = "wss://irc.example", account = "alice", nodeHex = "", gen = 1 } ] (enrolls out)
                    , \_ -> Expect.equal True done.attribution.registered
                    , \_ -> Expect.equal True done.attribution.enrollOnly
                    ]
                    ()
        , test "ERR_NOMOTD (422) ends the burst too" <|
            \_ ->
                let
                    ( logged, _ ) =
                        feed owner ":irc.example 900 kai kai!u@h alice :You are now logged in as alice"

                    ( _, out ) =
                        feed logged ":irc.example 422 kai :MOTD File is missing"
                in
                Expect.equal [ "" ] (List.map .nodeHex (enrolls out))
        , test "a guest enrolls nothing; a second 376 asks only once" <|
            \_ ->
                let
                    ( _, guestOut ) =
                        feed owner ":irc.example 376 kai :End of /MOTD command."

                    ( logged, _ ) =
                        feed owner ":irc.example 900 kai kai!u@h alice :You are now logged in as alice"

                    ( once, _ ) =
                        feed logged ":irc.example 376 kai :End of /MOTD command."

                    ( _, again ) =
                        feed once ":irc.example 376 kai :End of /MOTD command."
                in
                Expect.all
                    [ \_ -> Expect.equal [] (enrolls guestOut)
                    , \_ -> Expect.equal [] (enrolls again)
                    ]
                    ()
        , test "with ACCOUNTRESIDENCE the node path runs and 376 adds nothing" <|
            \_ ->
                let
                    ( supported, _ ) =
                        feed owner ":s 005 kai ACCOUNTRESIDENCE=0123456789abcdef CHANTYPES=# :are supported"

                    ( logged, first ) =
                        feed supported ":irc.example 900 kai kai!u@h alice :You are now logged in as alice"

                    ( _, out ) =
                        feed logged ":irc.example 376 kai :End of /MOTD command."
                in
                Expect.all
                    [ \_ -> Expect.equal [ "0123456789abcdef" ] (List.map .nodeHex (enrolls first))
                    , \_ -> Expect.equal [] (enrolls out)
                    ]
                    ()
        , test "a node-less reply sends IDENTITY ADD and never a residence proof" <|
            \_ ->
                let
                    ( logged, _ ) =
                        feed owner ":irc.example 900 kai kai!u@h alice :You are now logged in as alice"

                    ( registered, _ ) =
                        feed logged ":irc.example 376 kai :End of /MOTD command."

                    reply =
                        { account = "alice"
                        , nodeHex = ""
                        , gen = 1
                        , label = "onyx-abcdef0123456789"
                        , publicHex = String.repeat 64 "a"
                        , sig = String.repeat 128 "b"
                        , alreadyEnrolled = False
                        }

                    ( pending, out ) =
                        update (AttributionEnrollReply (Just reply)) registered

                    ( _, confirm ) =
                        feed pending ":irc.example NOTICE kai :IDENTITY ADDED label=onyx-abcdef0123456789"

                    ( _, skipped ) =
                        update (AttributionEnrollReply (Just { reply | alreadyEnrolled = True, sig = "" })) registered
                in
                Expect.all
                    [ \_ ->
                        Expect.equal
                            [ "IDENTITY ADD onyx-abcdef0123456789 " ++ String.repeat 64 "a" ++ " " ++ String.repeat 128 "b" ++ "\u{000D}\n" ]
                            (sendLines out)
                    , \_ ->
                        Expect.equal True
                            (List.member (AttributionConfirmEnrolled { serverUrl = "wss://irc.example", account = "alice", publicHex = String.repeat 64 "a" }) confirm)
                    , \_ -> Expect.equal [] skipped
                    ]
                    ()
        , test "the state machine: registered gates node-less, a known node wins" <|
            \_ ->
                let
                    named =
                        { blankSessionWith | account = Just "alice" }

                    blankSessionWith =
                        Attribution.blankSession

                    ( reg, fx ) =
                        Attribution.foldRegistered named

                    ( _, fxAgain ) =
                        Attribution.kickAttribution reg

                    ( _, fxUnregistered ) =
                        Attribution.kickAttribution named

                    stale =
                        { account = "alice", nodeHex = "", gen = 0, label = "onyx-1", publicHex = String.repeat 64 "a", sig = String.repeat 128 "b", alreadyEnrolled = False }

                    ( _, fxStale ) =
                        Attribution.foldEnrollReply { reg | nodeHex = Just "0123456789abcdef" } 0 stale
                in
                Expect.all
                    [ \_ -> Expect.equal (Attribution.RequestEnroll { serverUrl = "", account = "alice", nodeHex = "", gen = 0 }) fx
                    , \_ -> Expect.equal Attribution.NoEffect fxAgain
                    , \_ -> Expect.equal Attribution.NoEffect fxUnregistered
                    , \_ -> Expect.equal Attribution.NoEffect fxStale
                    , \_ -> Expect.equal False (Attribution.resetSession reg).registered
                    ]
                    ()
        ]



-- GUESTS AND DMS


guests : Test
guests =
    describe "guests and DMs"
        [ test "a guest's join sends nothing and shows the sign-in banner" <|
            \_ ->
                let
                    ( pressed, out ) =
                        update (CallJoin { channel = "#harbor", video = False }) guest
                in
                Expect.all
                    [ \_ -> Expect.equal [] out
                    , \_ -> Expect.equal Idle pressed.calls.lifecycle
                    , \_ -> Expect.equal (Just (CallUi.BannerGuest 0)) (CallUi.bannerFor pressed "#harbor")
                    , \_ -> query pressed |> Query.find [ testid "call-join-banner" ] |> Query.has [ Selector.text "Sign in to join calls", Selector.attribute (Attr.attribute "data-variant" "guest") ]
                    ]
                    ()
        , test "guest banner: people in voice; keep the name or sign in; never a join button" <|
            \_ ->
                let
                    m =
                        withVoice [ "mara", "jun" ] guest

                    banner =
                        query m |> Query.find [ testid "call-join-banner" ]
                in
                Expect.all
                    [ \_ -> banner |> Query.has [ Selector.text "2 people are in voice. Sign in to join." ]
                    , \_ -> banner |> Query.find [ testid "call-guest-claim" ] |> Query.has [ Selector.text "Keep the name odalys" ]
                    , \_ -> banner |> Query.find [ testid "call-guest-claim" ] |> Event.simulate Event.click |> Event.expect GuestClaimOpen
                    , \_ -> banner |> Query.find [ testid "call-guest-signin" ] |> Event.simulate Event.click |> Event.expect CallGuestSignIn
                    , \_ -> banner |> Query.findAll [ testid "call-join-voice" ] |> Query.count (Expect.equal 0)
                    , \_ -> Expect.equal (Just (CallUi.BannerInvite 2)) (CallUi.bannerFor { m | accountName = Just "odalys" } "#harbor")
                    ]
                    ()
        , test "a dismissed guest banner comes back when they press Call" <|
            \_ ->
                let
                    hidden =
                        step (CallBannerDismiss "#harbor") (withVoice [ "mara" ] guest)

                    again =
                        step (CallJoin { channel = "#harbor", video = False }) hidden
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (CallUi.bannerFor hidden "#harbor")
                    , \_ -> Expect.equal (Just (CallUi.BannerGuest 1)) (CallUi.bannerFor again "#harbor")
                    ]
                    ()
        , test "Sign in leaves for the sign-in form; accounts are untouched" <|
            \_ ->
                let
                    ( left, out ) =
                        update CallGuestSignIn guest

                    ( _, accountOut ) =
                        update CallGuestSignIn signedIn
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member WsDisconnect out)
                    , \_ -> Expect.equal ConnectSignIn left.connectForm.mode
                    , \_ -> Expect.equal [] accountOut
                    ]
                    ()
        , test "the Calls hub offers a guest the sign-in card, never a join" <|
            \_ ->
                let
                    q =
                        query { guest | callsOpen = True }
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "calls-hub-guest" ] |> Query.has [ Selector.text "Sign in to join calls" ]
                    , \_ -> q |> Query.findAll [ Selector.tag "button", Selector.containing [ Selector.text "Join call in #harbor" ] ] |> Query.count (Expect.equal 0)
                    , \_ -> query { signedIn | callsOpen = True } |> Query.findAll [ testid "calls-hub-guest" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "the hub never offers video while the engine reports no camera" <|
            \_ ->
                query { signedIn | callsOpen = True }
                    |> Query.findAll [ Selector.tag "button", Selector.containing [ Selector.text "Join with video in #harbor" ] ]
                    |> Query.count (Expect.equal 0)
        ]



-- PROVISIONAL JOIN


provisional : Test
provisional =
    describe "joining"
        [ test "a join is provisional at once, with the permission hint" <|
            \_ ->
                let
                    ( joining, out ) =
                        update (CallJoin { channel = "#harbor", video = False }) (withVoice [ "mara" ] signedIn)
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member (VoiceJoin { channel = "#harbor", video = False }) out)
                    , \_ -> Expect.equal { lifecycle = InCall, channel = Just "#harbor", withPeer = "", startedAt = Nothing, outcome = Nothing } joining.calls
                    , \_ -> query joining |> Query.find [ testid "voice-stage-state" ] |> Query.has [ Selector.text "Connecting to the call…" ]
                    , \_ -> query joining |> Query.find [ testid "call-joining-hint" ] |> Query.has [ Selector.text "Allow the microphone if your browser asks. Setting up encryption can take a few seconds." ]
                    , \_ -> query joining |> Query.findAll [ testid "call-join-banner" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "Leave while joining cancels: idle at once, the engine is told" <|
            \_ ->
                let
                    joining =
                        step (CallJoin { channel = "#harbor", video = False }) signedIn

                    ( left, out ) =
                        update CallLeave joining

                    established =
                        step (snapshot [ ( "state", Encode.string "in_call" ), ( "channel", Encode.string "#harbor" ), ( "startedAt", Encode.int 5000 ) ]) joining
                in
                Expect.all
                    [ \_ -> Expect.equal [ VoiceLeave { channel = "#harbor" } ] out
                    , \_ -> Expect.equal Idle left.calls.lifecycle
                    , \_ -> Expect.equal Nothing left.calls.outcome
                    , \_ -> Expect.equal (Just 5000) established.calls.startedAt
                    , \_ -> query established |> Query.findAll [ testid "call-joining-hint" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "a second press while the join is in flight does nothing" <|
            \_ ->
                let
                    joining =
                        step (CallJoin { channel = "#harbor", video = False }) signedIn

                    ( again, out ) =
                        update (CallJoin { channel = "#Harbor", video = False }) joining
                in
                Expect.all
                    [ \_ -> Expect.equal [] out
                    , \_ -> Expect.equal joining.calls again.calls
                    ]
                    ()
        , test "a failed join rolls the provisional stage back to the failed banner" <|
            \_ ->
                let
                    failed =
                        signedIn
                            |> step (CallJoin { channel = "#harbor", video = False })
                            |> step (snapshot [ ( "state", Encode.string "idle" ), ( "outcome", Encode.string "failed" ), ( "errorKind", Encode.string "permission" ) ])
                in
                Expect.all
                    [ \_ -> Expect.equal Idle failed.calls.lifecycle
                    , \_ -> query failed |> Query.find [ testid "call-join-banner" ] |> Query.has [ Selector.text "Couldn't join. Try again." ]
                    ]
                    ()
        ]



-- MEDIA ERRORS


toastTitles : Model -> List String
toastTitles model =
    List.map .title model.toasts


mediaErrors : Test
mediaErrors =
    describe "media failures are never silent"
        [ test "toast copy per error word" <|
            \_ ->
                let
                    toast fields =
                        CallDock.mediaToast (Encode.object (List.map (\( k, v ) -> ( k, Encode.string v )) fields))
                            |> Maybe.map (\t -> ( t.title, t.warn, t.group ))
                in
                Expect.all
                    [ \_ -> Expect.equal (Just ( "Call media problem", False, "voice-media" )) (toast [ ( "errorKind", "media" ) ])
                    , \_ -> Expect.equal (Just ( "Can't play ben's audio", True, "voice-decode-ben" )) (toast [ ( "errorKind", "decode" ), ( "errorPeer", "Ben" |> String.toLower ), ( "errorMedia", "voice" ) ])
                    , \_ -> Expect.equal (Just ( "Can't play cy's video", True, "voice-decode-cy" )) (toast [ ( "errorKind", "decode" ), ( "errorPeer", "cy" ), ( "errorMedia", "video" ) ])
                    , \_ -> Expect.equal (Just ( "ben's device key changed", True, "voice-key-ben" )) (toast [ ( "errorKind", "peer_key" ), ( "errorPeer", "ben" ) ])
                    , \_ -> Expect.equal Nothing (toast [ ( "errorKind", "peer_key" ), ( "errorPeer", "bad nick" ) ])
                    , \_ -> Expect.equal (Just ( "You were removed from the call", True, "voice-removed" )) (toast [ ( "errorKind", "removed" ), ( "mediaError", "You were removed from voice by mara" ) ])
                    , \_ -> Expect.equal (Just ( "Your microphone stopped", False, "voice-capture" )) (toast [ ( "errorKind", "capture" ) ])
                    , \_ -> Expect.equal (Just ( "Media codec unavailable", False, "voice-codec" )) (toast [ ( "errorKind", "codec" ) ])
                    , \_ -> Expect.equal Nothing (toast [ ( "errorKind", "permission" ) ])
                    , \_ -> Expect.equal Nothing (toast [])
                    ]
                    ()
        , test "an in-call error snapshot raises one toast and keeps the call" <|
            \_ ->
                let
                    live =
                        [ ( "state", Encode.string "in_call" ), ( "channel", Encode.string "#harbor" ), ( "startedAt", Encode.int 1000 ) ]

                    errored =
                        inCall
                            |> step (snapshot (live ++ [ ( "errorKind", Encode.string "decode" ), ( "errorPeer", Encode.string "mara" ), ( "errorMedia", Encode.string "voice" ) ]))
                            |> step (snapshot live)
                in
                Expect.all
                    [ \_ -> Expect.equal [ "Can't play mara's audio" ] (toastTitles errored)
                    , \_ -> Expect.equal InCall errored.calls.lifecycle
                    ]
                    ()
        , test "a key change is announced in the DM key-change language" <|
            \_ ->
                let
                    warned =
                        step (snapshot [ ( "state", Encode.string "in_call" ), ( "channel", Encode.string "#harbor" ), ( "startedAt", Encode.int 1000 ), ( "errorKind", Encode.string "peer_key" ), ( "errorPeer", Encode.string "jun" ) ]) inCall
                in
                Expect.all
                    [ \_ -> Expect.equal [ "jun's device key changed" ] (toastTitles warned)
                    , \_ -> Expect.equal [ ToastWarning ] (List.map .variant warned.toasts)
                    ]
                    ()
        , test "a lost microphone ends the call with its own banner" <|
            \_ ->
                let
                    lost =
                        signedIn
                            |> step (CallJoin { channel = "#harbor", video = False })
                            |> step (snapshot [ ( "state", Encode.string "idle" ), ( "outcome", Encode.string "failed" ), ( "errorKind", Encode.string "capture" ) ])
                in
                Expect.all
                    [ \_ -> Expect.equal (Just CallDock.CaptureLost) lost.callJoinError
                    , \_ -> query lost |> Query.find [ testid "call-join-banner" ] |> Query.has [ Selector.text "Your microphone stopped." ]
                    , \_ -> Expect.equal [ "Your microphone stopped" ] (toastTitles lost)
                    ]
                    ()
        ]



-- STAGE ANATOMY


stageAnatomy : Test
stageAnatomy =
    describe "stage head, controls-only toolbar, More"
        [ test "the head carries timer, people and the security chip; the toolbar is controls only" <|
            \_ ->
                let
                    q =
                        query inCall
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "call-meta" ] |> Query.has [ Selector.text "01:00", Selector.text "· 3 people" ]
                    , \_ -> q |> Query.find [ testid "call-meta" ] |> Query.has [ testid "call-security-chip" ]
                    , \_ -> q |> Query.find [ testid "voice-bar" ] |> Query.findAll [ testid "call-timer" ] |> Query.count (Expect.equal 0)
                    , \_ -> q |> Query.find [ testid "voice-bar" ] |> Query.findAll [ testid "call-security-chip" ] |> Query.count (Expect.equal 0)
                    , \_ -> q |> Query.find [ testid "voice-stage" ] |> Query.has [ Selector.attribute (Attr.attribute "data-count" "3") ]
                    ]
                    ()
        , test "More: a scrim closes it, and it offers the room invite" <|
            \_ ->
                let
                    opened =
                        step CallMoreToggle inCall

                    q =
                        query opened
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "call-more-scrim" ] |> Event.simulate Event.click |> Event.expect CallMoreClose
                    , \_ -> q |> Query.find [ testid "call-invite" ] |> Event.simulate Event.click |> Event.expect (InviteShareOpen "#harbor")
                    , \_ -> query inCall |> Query.findAll [ testid "call-more-scrim" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        ]
