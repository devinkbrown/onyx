module View.CallStage exposing
    ( announcer
    , controlBar
    , privacySheet
    , roomCallSurface
    , securityChip
    , voiceStage
    )

{-| v3/calls-c1 — C2 voice-only stage + control bar v1 + announcer,
and C3 security chip + call privacy sheet (`CALLS_DESIGN.md` §2.4,
§2.5, §2.12, §3.3).

Bar v1 carries Mute, More (one stub item: "Open voice settings",
disabled until C9) and Leave in the centre; where / timer / people on
the left; the security chip on the right. Camera / share / hand /
react / captions arrive with C4/C8 — the centre group is the seam.

Narrowings: icons are CSS-mask glyphs (`.onyx-ci`); the stage is
docked in the message column (not a fixed mobile bottom bar); the
connection-quality pip waits for C4's `qualityTier`; keyboard chords
and `aria-keyshortcuts` wait for C12.

-}

import App exposing (Model, Msg(..))
import CallUi
import Dict
import Html exposing (Html, button, dd, div, dl, dt, h2, li, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, disabled, id, type_)
import Html.Events exposing (on, onClick)
import Json.Decode as Decode
import Media exposing (HubPresentation(..))
import Prefs
import View.CallPresence exposing (callIcon, joinBanner)


{-| The call surface at the top of the message column: the stage +
bar while this room (or DM) is the live call target, else the
pre-join banner for a room.
-}
roomCallSurface : Model -> String -> Html Msg
roomCallSurface model target =
    if model.calls.lifecycle /= Media.Idle && CallUi.sameTarget (CallUi.callTarget model.calls) target then
        voiceStage model

    else if App.isChannelName model target then
        joinBanner model target

    else
        text ""


security : Model -> Maybe CallUi.Security
security model =
    CallUi.resolveSecurity model.calls.lifecycle model.callSecurityFeed


displayName : Model -> String -> String
displayName model key =
    let
        fromMembers =
            model.calls.channel
                |> Maybe.andThen (\c -> Dict.get (String.toLower c) model.channels)
                |> Maybe.andThen (\ch -> Dict.get (String.toLower key) ch.members)
                |> Maybe.map .nick
    in
    case fromMembers of
        Just nick ->
            nick

        Nothing ->
            if String.toLower model.calls.withPeer == String.toLower key then
                model.calls.withPeer

            else
                key


roleOf : Model -> String -> Maybe String
roleOf model key =
    model.calls.channel
        |> Maybe.andThen (\c -> Dict.get (String.toLower c) model.channels)
        |> Maybe.andThen (\ch -> Dict.get (String.toLower key) ch.members)
        |> Maybe.andThen (\m -> CallUi.roleWord m.modes)


people : Model -> List CallUi.Person
people model =
    CallUi.stagePeople
        { ourNick = model.ourNick
        , roster = CallUi.callRoster model.media model.calls
        , media = model.media
        , selfMuted = model.callSelfMuted
        , displayName = displayName model
        , roleOf = roleOf model
        }


motionWord : Model -> String
motionWord model =
    if model.sceneMotion == Prefs.SceneOff || model.sceneMotion == Prefs.SceneStill then
        "still"

    else
        "full"


presentationPip : HubPresentation -> String
presentationPip presentation =
    case presentation of
        HubEstablished ->
            "live"

        HubIdle ->
            "idle"

        _ ->
            "provisional"


{-| Voice-only stage (§2.5): status line, person cells, then the bar. -}
voiceStage : Model -> Html Msg
voiceStage model =
    let
        presentation =
            Media.classifyHubPresentation model.calls.lifecycle model.calls.startedAt

        everyone =
            people model

        count =
            List.length everyone

        density =
            CallUi.stageDensity count
    in
    section
        [ class "onyx-call-stage"
        , attribute "role" "region"
        , attribute "aria-label" "Voice call participants"
        , attribute "data-mode" "audio"
        , attribute "data-motion" (motionWord model)
        , attribute "data-testid" "voice-stage"
        ]
        [ p
            [ class "onyx-call-stage-status"
            , attribute "role" "status"
            , attribute "aria-live" "polite"
            , attribute "data-testid" "voice-stage-state"
            ]
            [ span [ class "onyx-call-pip", attribute "data-state" (presentationPip presentation) ] []
            , text (CallUi.stageStatus model.calls (Maybe.map .label (security model)))
            ]
        , case density of
            CallUi.DensityCollapsed ->
                div [ class "onyx-call-people onyx-call-people-collapsed" ]
                    [ span [ class "onyx-call-faces", attribute "aria-hidden" "true" ]
                        (List.map (\p_ -> span [ class "onyx-call-avatar onyx-call-avatar-md" ] [ text (initialOf p_.name) ]) (List.take 5 everyone))
                    , span [ class "onyx-call-more-people" ]
                        [ text
                            (String.join ", " (List.map .name (List.take 5 everyone))
                                ++ " and "
                                ++ String.fromInt (count - 5)
                                ++ " more"
                            )
                        ]
                    ]

            _ ->
                div
                    [ class "onyx-call-people"
                    , attribute "data-density"
                        (if density == CallUi.DensityCompact then
                            "compact"

                         else
                            "full"
                        )
                    ]
                    (List.map personCell everyone)
        , controlBar model
        ]


initialOf : String -> String
initialOf name =
    String.left 1 (String.toUpper (String.filter Char.isAlphaNum name ++ name))


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


personCell : CallUi.Person -> Html Msg
personCell person =
    div
        [ class "onyx-call-person"
        , attribute "role" "group"
        , attribute "aria-label" (CallUi.personAria person)
        , attribute "data-nick" person.key
        , attribute "data-speaking" (boolAttr person.speaking)
        , attribute "data-hand" (boolAttr person.hand)
        , attribute "data-muted" (boolAttr person.muted)
        , attribute "data-self" (boolAttr person.self)
        ]
        [ div [ class "onyx-call-ring" ]
            [ span [ class "onyx-call-avatar onyx-call-avatar-lg", attribute "aria-hidden" "true" ] [ text (initialOf person.name) ]
            , if person.hand then
                span [ class "onyx-call-badge onyx-call-badge-hand", attribute "title" "Hand raised" ] [ callIcon "hand" ]

              else if person.muted then
                span [ class "onyx-call-badge", attribute "title" "Muted" ] [ callIcon "mic-off" ]

              else
                text ""
            ]
        , span [ class "onyx-call-name", attribute "aria-hidden" "true" ]
            [ text person.name
            , if person.self then
                span [ class "onyx-call-you" ] [ text " · you" ]

              else
                text ""
            ]
        , case person.role of
            Just role ->
                span [ class "onyx-call-role", attribute "aria-hidden" "true" ] [ text role ]

            Nothing ->
                text ""
        ]


{-| In-call control bar v1 (§2.4). Rendered for ringing and in-call
lifecycles only.
-}
controlBar : Model -> Html Msg
controlBar model =
    let
        presentation =
            Media.classifyHubPresentation model.calls.lifecycle model.calls.startedAt

        where_ =
            CallUi.callTarget model.calls |> Maybe.withDefault "Call"

        count =
            List.length (people model)

        timer =
            case ( presentation, model.calls.startedAt ) of
                ( HubEstablished, Just started ) ->
                    let
                        d =
                            CallUi.formatDuration (round model.nowMs - started)
                    in
                    span
                        [ class "onyx-call-timer"
                        , attribute "role" "timer"
                        , attribute "aria-label" d.aria
                        , attribute "data-testid" "call-timer"
                        ]
                        [ text d.text ]

                _ ->
                    text ""

        muted =
            model.callSelfMuted
    in
    if presentation == HubIdle then
        text ""

    else
        div
            [ class "onyx-call-bar"
            , attribute "role" "toolbar"
            , attribute "aria-label" "Voice call controls"
            , attribute "data-testid" "voice-bar"
            ]
            [ div [ class "onyx-call-bar-left" ]
                [ span [ class "onyx-call-where" ] [ text where_ ]
                , timer
                , span [ class "onyx-call-people-count" ] [ text ("· " ++ CallUi.peopleLabel count) ]
                ]
            , div [ class "onyx-call-bar-center", attribute "role" "group", attribute "aria-label" "Call controls" ]
                [ button
                    [ type_ "button"
                    , class "onyx-cbtn"
                    , attribute "data-testid" "call-mute"
                    , attribute "aria-pressed" (boolAttr muted)
                    , attribute "aria-label"
                        (if muted then
                            "Unmute microphone"

                         else
                            "Mute microphone"
                        )
                    , onClick CallToggleMute
                    ]
                    [ callIcon
                        (if muted then
                            "mic-off"

                         else
                            "mic"
                        )
                    , span [ class "onyx-cbtn-cap" ]
                        [ text
                            (if muted then
                                "Unmute"

                             else
                                "Mute"
                            )
                        ]
                    ]
                , div [ class "onyx-call-more-wrap" ]
                    [ button
                        [ type_ "button"
                        , class "onyx-cbtn"
                        , attribute "data-testid" "call-more"
                        , attribute "aria-label" "More call tools"
                        , attribute "aria-haspopup" "dialog"
                        , attribute "aria-expanded" (boolAttr model.callMoreOpen)
                        , onClick CallMoreToggle
                        ]
                        [ callIcon "more", span [ class "onyx-cbtn-cap" ] [ text "More" ] ]
                    , if model.callMoreOpen then
                        moreTools

                      else
                        text ""
                    ]
                , button
                    [ type_ "button"
                    , class "onyx-cbtn onyx-cbtn-leave"
                    , attribute "data-testid" "call-leave"
                    , attribute "aria-label" "Leave voice call"
                    , onClick CallLeave
                    ]
                    [ callIcon "leave", span [ class "onyx-cbtn-cap" ] [ text "Leave" ] ]
                ]
            , div [ class "onyx-call-bar-right" ] [ securityChip model ]
            ]


{-| More call tools (§2.4) — v1 carries the Settings stub only; the
seam for deafen / record / invite / layout / stage size (C4/C5/C9).
-}
moreTools : Html Msg
moreTools =
    div
        [ class "onyx-call-more"
        , attribute "role" "dialog"
        , attribute "aria-label" "More call tools"
        , attribute "data-call-dialog" "more"
        , attribute "data-testid" "call-more-tools"
        , on "keydown" (escapeTo CallMoreClose)
        ]
        [ button
            [ type_ "button"
            , class "onyx-call-more-item"
            , attribute "data-initial-focus" "true"
            , attribute "aria-label" "Open voice settings"
            , attribute "aria-disabled" "true"
            , attribute "data-testid" "call-more-settings"
            ]
            [ callIcon "settings", text "Open voice settings" ]
        ]


escapeTo : Msg -> Decode.Decoder Msg
escapeTo msg =
    Decode.map2 Tuple.pair
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "isComposing" Decode.bool, Decode.succeed False ])
        |> Decode.andThen
            (\( key, composing ) ->
                if key == "Escape" && not composing then
                    Decode.succeed msg

                else
                    Decode.fail "ignored"
            )


securityGlyph : CallUi.SecurityIcon -> String
securityGlyph icon =
    case icon of
        CallUi.IconLock ->
            "lock"

        CallUi.IconLockOpen ->
            "lock-open"

        CallUi.IconShield ->
            "shield"

        CallUi.IconWarning ->
            "warn"

        CallUi.IconSpinner ->
            "spinner"

        CallUi.IconStage ->
            "stage"


{-| Security chip (§2.4 right zone). Never rendered idle. -}
securityChip : Model -> Html Msg
securityChip model =
    case security model of
        Just sec ->
            button
                [ type_ "button"
                , class "onyx-sec-chip"
                , attribute "data-testid" "call-security-chip"
                , attribute "data-level" (CallUi.levelWord sec.level)
                , attribute "data-tone" (CallUi.toneWord sec.tone)
                , attribute "data-icon" (CallUi.iconWord sec.icon)
                , attribute "aria-haspopup" "dialog"
                , attribute "aria-expanded" (boolAttr model.callPrivacyOpen)
                , attribute "aria-label" (sec.detail ++ " Open call privacy details.")
                , onClick CallPrivacyOpen
                ]
                [ callIcon (securityGlyph sec.icon), span [ attribute "aria-hidden" "true" ] [ text sec.label ] ]

        Nothing ->
            text ""


{-| Call privacy sheet (§2.12). Focus trap + restore live in
`ports.js` (`[data-call-dialog]`); Escape and the backdrop close it.
-}
privacySheet : Model -> Html Msg
privacySheet model =
    case ( model.callPrivacyOpen, security model ) of
        ( True, Just sec ) ->
            let
                feed =
                    model.callSecurityFeed

                sfu =
                    CallUi.sfuView feed.sfu

                selfKey =
                    String.toLower model.ourNick

                peers =
                    CallUi.callRoster model.media model.calls
                        |> List.map String.toLower
                        |> List.filter (\k -> k /= selfKey)
            in
            div [ class "onyx-call-sheet-layer" ]
                [ div
                    [ class "onyx-call-sheet-backdrop"
                    , attribute "role" "presentation"
                    , onClick CallPrivacyClose
                    ]
                    []
                , section
                    [ class "onyx-call-sheet onyx-call-privacy-sheet"
                    , attribute "role" "dialog"
                    , attribute "aria-modal" "true"
                    , attribute "aria-labelledby" "call-privacy-title"
                    , attribute "aria-describedby" "call-privacy-sub"
                    , attribute "data-call-dialog" "privacy"
                    , attribute "data-testid" "call-privacy-sheet"
                    , attribute "data-privacy-level" (CallUi.levelWord sec.level)
                    , attribute "tabindex" "-1"
                    , on "keydown" (escapeTo CallPrivacyClose)
                    ]
                    [ div [ class "onyx-call-sheet-head" ]
                        [ div []
                            [ h2 [ id "call-privacy-title" ] [ text (CallUi.privacyTitle sec.level) ]
                            , p [ id "call-privacy-sub" ] [ text "How this call is protected." ]
                            ]
                        , button
                            [ type_ "button"
                            , class "onyx-call-sheet-close"
                            , attribute "aria-label" "Close call privacy"
                            , attribute "data-initial-focus" "true"
                            , onClick CallPrivacyClose
                            ]
                            [ callIcon "x" ]
                        ]
                    , div [ class "onyx-call-sheet-body" ]
                        [ div [ class "onyx-call-level", attribute "data-tone" (CallUi.toneWord sec.tone) ]
                            [ callIcon (securityGlyph sec.icon)
                            , div []
                                [ strong [] [ text sec.label ]
                                , span [] [ text sec.detail ]
                                ]
                            ]
                        , dl [ class "onyx-call-facts" ]
                            [ div []
                                [ dt [] [ text "Media path" ]
                                , dd [ attribute "data-testid" "call-privacy-server-access" ] [ text (CallUi.mediaPathCopy sec.level) ]
                                ]
                            , div []
                                [ dt [] [ text "SFU topology" ]
                                , dd
                                    [ attribute "data-testid" "call-privacy-sfu-cascade"
                                    , attribute "data-sfu-cascade-mode" sfu.mode
                                    , attribute "data-sfu-cascade-hops" (String.fromInt sfu.hops)
                                    ]
                                    [ text sfu.label
                                    , span [ class "onyx-call-dim" ] [ text (" — " ++ sfu.detail) ]
                                    ]
                                ]
                            , div []
                                [ dt [] [ text "Privacy code" ]
                                , dd [ class "onyx-call-dim", attribute "data-testid" "call-privacy-epoch" ]
                                    [ text "Available when end-to-end media encryption is active." ]
                                ]
                            , div []
                                [ dt [] [ text "Your media fingerprint" ]
                                , dd
                                    [ attribute "data-testid" "call-privacy-local-fingerprint"
                                    , attribute "aria-describedby" "call-privacy-fingerprint-hint"
                                    ]
                                    [ case feed.localFingerprint of
                                        CallUi.FpReady code ->
                                            span [ class "onyx-call-fp" ] [ text (CallUi.fingerprintGroups code) ]

                                        CallUi.FpLoading ->
                                            text "Loading…"

                                        CallUi.FpUnavailable ->
                                            text "Unavailable until the media engine is ready."
                                    ]
                                ]
                            , div []
                                [ dt [] [ text "People in this call" ]
                                , dd []
                                    [ ul [ class "onyx-call-peer-list", attribute "data-testid" "call-privacy-peers" ]
                                        (List.map
                                            (\key ->
                                                li []
                                                    [ span [ class "onyx-call-avatar onyx-call-avatar-sm", attribute "aria-hidden" "true" ] [ text (initialOf (displayName model key)) ]
                                                    , span [ class "onyx-call-peer-name" ] [ text (displayName model key) ]
                                                    , case Dict.get key feed.peerFingerprints of
                                                        Just code ->
                                                            span [ class "onyx-call-fp onyx-call-fp-sm" ] [ text (CallUi.fingerprintGroups code) ]

                                                        Nothing ->
                                                            span [ class "onyx-call-fp onyx-call-fp-sm onyx-call-dim" ] [ text "Loading…" ]
                                                    ]
                                            )
                                            peers
                                        )
                                    ]
                                ]
                            ]
                        , p [ class "onyx-call-hint", id "call-privacy-fingerprint-hint" ]
                            [ text "Compare this code out of band to confirm your media identity. It does not prove end-to-end encryption by itself." ]
                        ]
                    ]
                ]

        _ ->
            text ""


{-| Roster-delta announcer (§3.3): always mounted, polite, atomic. -}
announcer : Model -> Html Msg
announcer model =
    div
        [ class "sr-only"
        , attribute "role" "status"
        , attribute "aria-live" "polite"
        , attribute "aria-atomic" "true"
        , attribute "data-testid" "call-status-announcer"
        ]
        [ text model.callAnnouncer.message ]
