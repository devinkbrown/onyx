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

Bar v1 carries Mute, More and Leave in the centre (v3/calls-c8:
More → "Open voice settings" opens the C9 sheet; Hand / React /
Captions join the centre group); where / timer / people on
the left; the security chip on the right. v3/calls-c4 adds Camera and
Share to the centre (Share moves into More <768px), Deafen / layout /
stage size to More, the connection pip to the right zone, the
quality prompt above the bar and the video stage (`View.CallVideo`);
hand / react / captions arrive with C8.

Narrowings: icons are CSS-mask glyphs (`.onyx-ci`); the stage is
docked in the message column (not a fixed mobile bottom bar); the
connection-quality pip waits for C4's `qualityTier`; keyboard chords
and `aria-keyshortcuts` land with C12 (v3/calls-c11).

-}

import App exposing (Model, Msg(..))
import CallUi
import Dict
import Html exposing (Html, button, dd, div, dl, dt, h2, li, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, disabled, id, title, type_)
import Json.Decode
import Html.Events exposing (on, onClick)
import Json.Decode as Decode
import Media exposing (HubPresentation(..))
import Prefs
import View.CallPresence exposing (callIcon, joinBanner)
-- v3/calls-c4
import CallMedia
import View.CallVideo
import View.Sheet as Sheet
import View.CallDock -- v3/calls-c6
-- v3/calls-c8
import View.CallOverlays
import View.VoiceSettings
-- v3/calls-c11
import View.StageMode


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
    let
        feed =
            model.callSecurityFeed
    in
    -- v3/calls-c11: a live stage is a broadcast, never a private call
    CallUi.resolveSecurity model.calls.lifecycle
        { feed | stageMode = feed.stageMode || View.StageMode.callStageRoom model /= Nothing }


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

        -- v3/calls-c11: on a stage only speakers get cells / tiles
        everyone =
            List.filter (\p_ -> View.StageMode.onStage model p_.key) (people model)

        count =
            List.length everyone

        density =
            CallUi.stageDensity count

        -- v3/calls-c4
        videoMode =
            View.CallVideo.active model

        suffix =
            View.CallVideo.statusSuffix model

        statusText =
            (case ( suffix.share, presentation ) of
                ( Just sharing, HubEstablished ) ->
                    sharing

                _ ->
                    -- v3/calls-c11
                    case ( presentation, View.StageMode.statusOverride model ) of
                        ( HubEstablished, Just stageLine ) ->
                            stageLine

                        _ ->
                            CallUi.stageStatus model.calls (Maybe.map .label (security model))
            )
                ++ (if suffix.protecting && presentation /= HubIdle then
                        " · Protecting audio"

                    else
                        ""
                   )
    in
    section
        [ class "onyx-call-stage"
        , attribute "role" "region"
        , attribute "aria-label"
            (if videoMode then
                "Video call participants"

             else
                "Voice call participants"
            )
        , attribute "data-mode"
            (if videoMode then
                "video"

             else
                "audio"
            )
        , attribute "data-layout" (CallMedia.viewWord (View.CallVideo.stageView model))
        , attribute "data-size" (CallMedia.sizeWord model.callStageSize)
        , attribute "data-motion" (motionWord model)
        , attribute "data-testid" "voice-stage"
        , attribute "data-reconnecting" (boolAttr (View.CallDock.reconnectingNow model)) -- v3/calls-c6
        , attribute "data-count" (String.fromInt count) -- v3/rx-calls
        ]
        [ -- v3/rx-calls: one head row — the live status on the left, the
          -- call facts (where / timer / people) and the security chip on
          -- the right — so the bar below is controls only.
          div [ class "onyx-call-stage-head" ]
            [ headFaces everyone
            , p
                [ class "onyx-call-stage-status"
                , attribute "role" "status"
                , attribute "aria-live" "polite"
                , attribute "data-testid" "voice-stage-state"
                ]
                -- v3/calls-c6: derived reconnecting state (spec §2.14)
                (if View.CallDock.reconnectingNow model then
                    [ span [ class "onyx-call-pip", attribute "data-state" "provisional" ] []
                    , span [ class "onyx-call-stage-status-text" ] [ text "Reconnecting…" ]
                    ]

                 else
                    [ span [ class "onyx-call-pip", attribute "data-state" (presentationPip presentation) ] []
                    , span [ class "onyx-call-stage-status-text" ] [ text statusText ]
                    ]
                )
            , callMeta model
            ]
        , View.CallDock.lostBanner model -- v3/calls-c6
        , if videoMode then
            View.CallVideo.stageBody model

          else
          case density of
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
        -- v3/rx-calls: the join is in flight (capture + device key)
        , if presentation == HubProvisional && not (View.CallDock.reconnectingNow model) then
            p [ class "onyx-call-joining", attribute "data-testid" "call-joining-hint" ]
                [ text "Allow the microphone if your browser asks. Setting up encryption can take a few seconds." ]

          else
            text ""
        , View.StageMode.audienceLine model -- v3/calls-c11
        -- v3/calls-c8: reaction chips + live captions, docked above
        -- the bar (never over a control)
        , View.CallOverlays.reactionChips model
        , View.CallOverlays.captionsOverlay model
        , View.CallVideo.qualityPrompt model
        , controlBar model
        ]


{-| v3/rx-calls — who is here, at a glance, for short screens where
the people row folds into the head (the full row stays in the
accessibility tree). Decorative: names ride the cells' labels.
-}
headFaces : List CallUi.Person -> Html Msg
headFaces everyone =
    let
        extra =
            List.length everyone - 5
    in
    span [ class "onyx-call-head-faces", attribute "aria-hidden" "true" ]
        (List.map
            (\p_ ->
                span
                    [ class "onyx-call-avatar onyx-call-avatar-sm"
                    , attribute "data-speaking" (boolAttr p_.speaking)
                    , attribute "data-hand" (boolAttr p_.hand)
                    , title p_.name
                    ]
                    [ text (initialOf p_.name) ]
            )
            (List.take 5 everyone)
            ++ (if extra > 0 then
                    [ span [ class "onyx-call-head-more" ] [ text ("+" ++ String.fromInt extra) ] ]

                else
                    []
               )
        )


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


{-| v3/rx-calls — the head row's right side: where (hub only; the
room header already names it), the timer, the people count, the
push-to-talk hint, the connection pip and the security chip.
-}
callMeta : Model -> Html Msg
callMeta model =
    let
        presentation =
            Media.classifyHubPresentation model.calls.lifecycle model.calls.startedAt

        where_ =
            CallUi.callTarget model.calls |> Maybe.withDefault "Call"

        count =
            List.length (people model)

        timer =
            if View.CallDock.reconnectingNow model then
                -- v3/calls-c6: the clock is unknown while reconnecting
                span [ class "onyx-call-timer", attribute "data-testid" "call-timer" ] [ text "—" ]

            else
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
    in
    if presentation == HubIdle then
        text ""

    else
        div [ class "onyx-call-meta", attribute "data-testid" "call-meta" ]
            [ span [ class "onyx-call-where" ] [ text where_ ]
            , timer
            , span [ class "onyx-call-people-count" ] [ text ("· " ++ CallUi.peopleLabel count) ]
            , View.VoiceSettings.pttHint model -- v3/calls-c8
            , View.CallVideo.qualityPip model
            , securityChip model
            ]


{-| In-call control bar v1 (§2.4). Rendered for ringing and in-call
lifecycles only.
-}
controlBar : Model -> Html Msg
controlBar model =
    let
        presentation =
            Media.classifyHubPresentation model.calls.lifecycle model.calls.startedAt

        -- v3/calls-c6: every toggle but Leave waits out a reconnect
        reconnecting =
            View.CallDock.reconnectingNow model

        muted =
            model.callSelfMuted

        -- v3/calls-c11
        leaveButton =
            button
                [ type_ "button"
                , class "onyx-cbtn onyx-cbtn-leave"
                , attribute "data-testid" "call-leave"
                , attribute "aria-label" "Leave voice call"
                , attribute "aria-keyshortcuts" View.StageMode.keys.leave
                , onClick CallLeave
                ]
                [ callIcon "leave", span [ class "onyx-cbtn-cap" ] [ text "Leave" ] ]
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
            [ div [ class "onyx-call-bar-center", attribute "role" "group", attribute "aria-label" "Call controls" ]
              <|
                -- v3/calls-c11: the stage audience gets Hand / Leave stage
                Maybe.withDefault
                [ button
                    [ type_ "button"
                    , class "onyx-cbtn"
                    , attribute "data-testid" "call-mute"
                    , attribute "aria-keyshortcuts" View.StageMode.keys.mute -- v3/calls-c11
                    , disabled reconnecting -- v3/calls-c6
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
                -- v3/calls-c4: camera + share (share moves into More <768px)
                , if model.callLocal.cameraSupported then
                    cameraButton model

                  else
                    text ""
                , shareButton model "onyx-cbtn onyx-cbtn-share" "screenshare-button"
                -- v3/calls-c8: hand / react / captions (React moves into More <768px)
                , View.CallOverlays.handButton model reconnecting
                , View.CallOverlays.reactButton model reconnecting
                , View.CallOverlays.captionsButton model reconnecting
                , div [ class "onyx-call-more-wrap" ]
                    [ button
                        [ type_ "button"
                        , class "onyx-cbtn"
                        , attribute "data-testid" "call-more"
                        , disabled reconnecting -- v3/calls-c6
                        , attribute "aria-label" "More call tools"
                        , attribute "aria-haspopup" "dialog"
                        , attribute "aria-expanded" (boolAttr model.callMoreOpen)
                        , onClick CallMoreToggle
                        ]
                        [ callIcon "more", span [ class "onyx-cbtn-cap" ] [ text "More" ] ]
                    ]
                , View.StageMode.endStageButton model -- v3/calls-c11
                , leaveButton
                ]
                (View.StageMode.audienceBarCenter model leaveButton)
            -- v3/rx-calls: More is a row of tools under the controls on
            -- wide stages and a bottom sheet on phones / short screens;
            -- tap or click outside closes it (the phone scrim dims).
            , if model.callMoreOpen then
                div
                    [ class "onyx-call-more-scrim"
                    , attribute "data-testid" "call-more-scrim"
                    , attribute "aria-hidden" "true"
                    , onClick CallMoreClose
                    ]
                    []

              else
                text ""
            , if model.callMoreOpen then
                moreTools model

              else
                text ""
            , View.CallOverlays.reactMenu model -- v3/calls-c8
            -- v3/calls-c4
            , span
                [ class "sr-only"
                , attribute "role" "status"
                , attribute "aria-live" "polite"
                , attribute "aria-atomic" "true"
                , attribute "data-testid" "screenshare-status"
                ]
                [ text model.callLocal.shareStatus ]
            ]


-- v3/calls-c4
cameraButton : Model -> Html Msg
cameraButton model =
    let
        on =
            model.callLocal.camera
    in
    button
        [ type_ "button"
        , class "onyx-cbtn"
        , attribute "data-testid" "camera-button"
        , attribute "aria-keyshortcuts" View.StageMode.keys.camera -- v3/calls-c11
        , attribute "aria-pressed" (boolAttr on)
        , attribute "aria-label"
            (if on then
                "Turn off camera"

             else
                "Turn on camera"
            )
        , disabled (model.calls.lifecycle /= Media.InCall)
        , onClick CallToggleCamera
        ]
        [ callIcon
            (if on then
                "cam"

             else
                "cam-off"
            )
        , span [ class "onyx-cbtn-cap" ] [ text "Camera" ]
        ]


shareButton : Model -> String -> String -> Html Msg
shareButton model cls testid =
    let
        local =
            model.callLocal

        label =
            CallMedia.shareLabel local
    in
    button
        ([ type_ "button"
         , class cls
         , attribute "data-testid" testid
         , attribute "aria-pressed" (boolAttr (local.share == CallMedia.ShareOn))
         , attribute "aria-label" label
         , title label
         , disabled (CallMedia.shareDisabled local || model.calls.lifecycle /= Media.InCall)
         , onClick CallToggleShare
         ]
            ++ (if local.share == CallMedia.SharePending then
                    [ attribute "aria-busy" "true" ]

                else
                    []
               )
        )
        [ callIcon "screen"
        , span [ class "onyx-cbtn-cap onyx-call-more-cap" ] [ text (CallMedia.shareCaption local) ]
        ]


moreItem : List (Html.Attribute Msg) -> String -> String -> Html Msg
moreItem attrs icon label =
    button ([ type_ "button", class "onyx-call-more-item" ] ++ attrs) [ callIcon icon, text label ]


{-| More call tools (§2.4) — v1 carries the Settings stub only; the
seam for deafen / record / invite / layout / stage size (C4/C5/C9).
-}
moreTools : Model -> Html Msg
moreTools model =
    div
        [ class "onyx-call-more"
        , attribute "role" "dialog"
        , attribute "aria-label" "More call tools"
        , attribute "data-call-dialog" "more"
        , attribute "data-testid" "call-more-tools"
        , Html.Events.preventDefaultOn "keydown" (Json.Decode.map (\escMsg -> ( escMsg, True )) (escapeTo CallMoreClose))
        ]
        [ -- v3/calls-c4
          moreItem
            [ attribute "data-initial-focus" "true"
            , attribute "aria-pressed" (boolAttr model.callLocal.deafened)
            , attribute "aria-label"
                (if model.callLocal.deafened then
                    "Undeafen"

                 else
                    "Deafen"
                )
            , attribute "data-testid" "deafen-button"
            , onClick CallToggleDeafen
            ]
            "deafen"
            (if model.callLocal.deafened then
                "Undeafen"

             else
                "Deafen"
            )
        , -- v3/calls-engine: phones get Share only through More; where the
          -- platform has no screen picker (iPhone/iPad WebKit, reported as
          -- shareSupported = false) it is not offered at all.
          if model.callLocal.shareSupported then
            div [ class "onyx-call-more-share" ]
                [ shareButton model "onyx-call-more-item" "call-more-share" ]

          else
            text ""
        , View.CallOverlays.moreReactItem model -- v3/calls-c8
        , moreItem
            [ attribute "aria-pressed" (boolAttr (model.callLayout == CallMedia.LayoutSpotlight))
            , attribute "data-testid" "layout-button"
            , attribute "aria-keyshortcuts" View.StageMode.keys.layout -- v3/calls-c11
            , onClick CallLayoutToggle
            ]
            "grid"
            (CallMedia.layoutToggleLabel model.callLayout)
        , moreItem
            [ attribute "aria-pressed" (boolAttr (model.callStageSize /= CallMedia.SizeCompact))
            , attribute "data-testid" "stage-size-button"
            , attribute "aria-keyshortcuts" View.StageMode.keys.size -- v3/calls-c11
            , onClick CallStageSizeCycle
            ]
            "expand"
            (CallMedia.stageSizeLabel model.callStageSize)
        -- v3/rx-calls: invite with the room link (rooms only)
        , case model.calls.channel of
            Just room ->
                moreItem
                    [ attribute "data-testid" "call-invite"
                    , onClick (InviteShareOpen room)
                    ]
                    "link"
                    "Invite people"

            Nothing ->
                text ""
        -- v3/calls-c8: the live settings entry (was a disabled stub)
        , View.CallOverlays.settingsItem
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
            Sheet.view
                { scope = "call-privacy"
                , label = Sheet.LabelledBy "call-privacy-title"
                , onClose = CallPrivacyClose
                , placement = Sheet.Center
                , layerClass = "onyx-call-sheet-layer"
                , panelClass = "onyx-call-sheet onyx-call-privacy-sheet"
                , backdropClass = "onyx-call-sheet-backdrop"
                , layerAttrs = []
                , modal = True
                , attrs =
                    [ attribute "aria-describedby" "call-privacy-sub"
                    , attribute "data-call-dialog" "privacy"
                    , attribute "data-testid" "call-privacy-sheet"
                    , attribute "data-privacy-level" (CallUi.levelWord sec.level)
                    ]
                }
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
        -- v3/calls-c11 (C12): ports.js forwards call chords only while on
        , attribute "data-call-keys"
            (if model.calls.lifecycle == Media.InCall then
                "on"

             else
                "off"
            )
        ]
        [ text model.callAnnouncer.message ]
