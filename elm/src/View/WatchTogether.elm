module View.WatchTogether exposing (card, menuItem, startSheet)

{-| v3/gap-watch — Watch Together surfaces (`WatchTogether` holds the
rules; this module only renders them).

  - `card`: the room activity card. A compact sticky bar above the
    transcript (state, title, clock, the link's host, Open, details,
    Close) with a details disclosure that overlays the transcript
    instead of pushing it (progress / seek, host, participant roster,
    join / leave, handoff offer / accept / cancel, end with
    confirmation, and the plain-words note on what is synchronised).
  - `startSheet`: title / link / length → review → confirm, through
    the shared `View.Sheet` dialog (bottom sheet on phones).
  - `menuItem`: the room More-menu entry that starts one, or shows the
    current one (turning the `watchTogether` preference on).

Links are untrusted: they are shown with their host before anyone
presses Open, only http(s) links that pass `WatchTogether.checkUrl`
ever become an `href`, and they open in a new tab with no opener and
no referrer. Nothing is embedded and nothing navigates on its own.

-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, dd, dl, dt, form, h2, input, label, li, option, p, section, select, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, classList, for, href, id, placeholder, rel, selected, style, tabindex, target, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Json.Decode as Decode
import View.Icon exposing (icon)
import View.Sheet as Sheet
import WatchTogether as WT


ctxOf : Model -> WT.Ctx
ctxOf model =
    WT.context (model.connection == App.Live && model.isupport.ircx) model


wrap : WT.Msg -> Msg
wrap =
    WatchMsg


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


lower : String -> String
lower =
    String.toLower



-- ── room More menu ─────────────────────────────────────────────────────


{-| The room More-menu entry (rooms on an IRCX link only). -}
menuItem : Model -> Html Msg
menuItem model =
    case model.activeChannel of
        Just channel ->
            if App.isChannelName model channel && model.isupport.ircx then
                let
                    ctx =
                        ctxOf model

                    active =
                        ctx.rawFor channel |> Maybe.andThen WT.parse

                    ( label, state ) =
                        case active of
                            Just _ ->
                                ( "Watch together", "Active" )

                            Nothing ->
                                case WT.canStart ctx channel of
                                    Ok () ->
                                        ( "Start watch together", "" )

                                    Err _ ->
                                        ( "Watch together", "Operators start" )
                in
                button
                    [ type_ "button"
                    , class "onyx-room-more-watch"
                    , attribute "data-testid" "room-watch-together"
                    , onClick (wrap (WT.MenuSelect channel))
                    ]
                    (text label
                        :: (if String.isEmpty state then
                                []

                            else
                                [ span [ class "onyx-room-more-watch-state" ] [ text state ] ]
                           )
                    )

            else
                text ""

        Nothing ->
            text ""



-- ── activity card ──────────────────────────────────────────────────────


{-| The room's activity card (nothing when the preference is off or the
room has no valid activity). -}
card : Model -> String -> Html Msg
card model channel =
    let
        ctx =
            ctxOf model
    in
    if not ctx.enabled then
        text ""

    else
        case ctx.rawFor channel of
            Just raw ->
                case WT.parse raw of
                    Just activity ->
                        cardView model ctx channel raw activity

                    Nothing ->
                        text ""

            Nothing ->
                text ""


type alias View =
    { ctx : WT.Ctx
    , w : WT.Model
    , channel : String
    , raw : String
    , a : WT.Activity
    , rev : Maybe WT.Rev
    , self : Maybe String
    , host : Bool
    , participant : Bool
    , writable : Bool
    , busy : Bool
    , position : Maybe Int
    , ended : Bool
    , link : Maybe ( String, String )
    }


cardView : Model -> WT.Ctx -> String -> String -> WT.Activity -> Html Msg
cardView model ctx channel raw a =
    let
        w =
            model.watch

        clock =
            WT.clockFor ctx.nowMs w.anchors channel raw a

        self =
            ctx.self

        busy =
            case WT.pendingFor channel w of
                Just p ->
                    ctx.nowMs - p.sentAt < WT.pendingTimeoutMs

                Nothing ->
                    False

        isHost =
            Maybe.map (\s -> WT.isHost s a) self |> Maybe.withDefault False

        livePosition =
            WT.positionAt ctx.nowMs clock.anchor a

        position =
            case w.scrub of
                Just ( ch, n ) ->
                    if ch == lower channel && isHost then
                        Just n

                    else
                        livePosition

                Nothing ->
                    livePosition

        v =
            { ctx = ctx
            , w = w
            , channel = channel
            , raw = raw
            , a = a
            , rev = Maybe.map (\s -> { channel = channel, raw = raw, self = s }) self
            , self = self
            , host = isHost
            , participant = Maybe.map (\s -> WT.isParticipant s a) self |> Maybe.withDefault False
            , writable = ctx.online && ctx.canWrite channel
            , busy = busy
            , position = position
            , ended = WT.finished ctx.nowMs clock.anchor a
            , link = a.url |> Maybe.andThen (\u -> WT.urlHost u |> Maybe.map (\h -> ( u, h )))
            }

        stateKey =
            if v.ended then
                "finished"

            else
                case a.state of
                    WT.Playing ->
                        "playing"

                    WT.Paused ->
                        "paused"

                    WT.Seeking ->
                        "seeking"

                    WT.Handoff ->
                        "handoff"

                    WT.Idle ->
                        "idle"

        isPlaying =
            a.state == WT.Playing && not v.ended
    in
    section
        [ class "onyx-watch"
        , attribute "data-state" stateKey
        , attribute "data-expanded" (boolAttr w.expanded)
        , attribute "aria-labelledby" "onyx-watch-title"
        , attribute "aria-describedby" "onyx-watch-line"
        , attribute "data-testid" "watch-card"
        ]
        [ div [ class "onyx-watch-bar" ]
            [ leadControl v isPlaying
            , div [ class "onyx-watch-heading" ]
                [ p [ class "onyx-watch-kicker" ] [ text "Watch together" ]
                , h2 [ class "onyx-watch-title", id "onyx-watch-title", attribute "title" a.title ]
                    [ span [ class "sr-only" ] [ text "Watch together: " ], text a.title ]
                , p [ class "onyx-watch-line", id "onyx-watch-line" ]
                    ([ span [ class "onyx-watch-state" ] [ text (WT.stateLabel v.ended a) ]
                     , span [ class "onyx-watch-clock" ] [ text (clockText v) ]
                     ]
                        ++ (case v.link of
                                Just ( _, host ) ->
                                    [ span [ class "onyx-watch-site" ] [ text host ] ]

                                Nothing ->
                                    []
                           )
                    )
                ]
            , openLink v False
            , button
                [ type_ "button"
                , class "onyx-watch-icon-btn onyx-watch-more"
                , id "watch-details-toggle"
                , attribute "aria-expanded" (boolAttr w.expanded)
                , attribute "aria-controls" "watch-details"
                , attribute "aria-label" "Watch together details and controls"
                , attribute "title" "Details"
                , attribute "data-testid" "watch-details-toggle"
                , onClick (wrap WT.ToggleExpanded)
                ]
                [ icon "chevron-down" ]
            , button
                [ type_ "button"
                , class "onyx-watch-icon-btn onyx-watch-close"
                , attribute "aria-label" "Hide watch together"
                , attribute "title" "Hide watch together on this device"
                , attribute "data-testid" "watch-close"
                , onClick (wrap WT.Hide)
                ]
                [ icon "x" ]
            ]
        , progressTrack v
        , if w.expanded then
            details v

          else
            text ""
        , p
            [ class "onyx-watch-status"
            , classList [ ( "onyx-watch-status-problem", noticeTone v == Just WT.Problem ) ]
            , id "watch-status"
            , attribute "role" "status"
            , attribute "aria-live" "polite"
            , attribute "aria-atomic" "true"
            , tabindex -1
            , attribute "data-testid" "watch-participation-status"
            ]
            [ text (noticeText v) ]
        ]


noticeFor : View -> Maybe WT.Notice
noticeFor v =
    case v.w.notice of
        Just n ->
            if lower n.channel == lower v.channel then
                Just n

            else
                Nothing

        Nothing ->
            Nothing


noticeText : View -> String
noticeText v =
    noticeFor v |> Maybe.map .text |> Maybe.withDefault ""


noticeTone : View -> Maybe WT.Tone
noticeTone v =
    noticeFor v |> Maybe.map .tone


clockText : View -> String
clockText v =
    case v.a.duration of
        Just d ->
            WT.formatClock v.position ++ " / " ++ WT.formatClock (Just d)

        Nothing ->
            WT.formatClock v.position


{-| The host's play / pause (everyone else sees a state glyph). -}
leadControl : View -> Bool -> Html Msg
leadControl v isPlaying =
    case v.rev of
        Just rev ->
            if v.host && v.writable && v.a.state /= WT.Handoff then
                button
                    [ type_ "button"
                    , class "onyx-watch-icon-btn onyx-watch-play"
                    , attribute "aria-label"
                        (if isPlaying then
                            "Pause for everyone"

                         else
                            "Play for everyone"
                        )
                    , attribute "aria-disabled" (boolAttr v.busy)
                    , attribute "data-testid" "watch-play"
                    , onClick
                        (wrap
                            (if isPlaying then
                                WT.Pause rev

                             else
                                WT.Play rev
                            )
                        )
                    ]
                    [ icon
                        (if isPlaying then
                            "watch-pause"

                         else
                            "watch-play"
                        )
                    ]

            else
                glyph isPlaying

        Nothing ->
            glyph isPlaying


glyph : Bool -> Html Msg
glyph isPlaying =
    span [ class "onyx-watch-glyph", attribute "aria-hidden" "true" ]
        [ icon
            (if isPlaying then
                "watch-play"

             else
                "watch-pause"
            )
        ]


{-| The Open link: http(s) only (already gated), a new tab with no
opener and no referrer, named with the host it goes to. -}
openLink : View -> Bool -> Html Msg
openLink v wide =
    case v.link of
        Just ( url, host ) ->
            a
                [ class
                    (if wide then
                        "onyx-watch-open-wide"

                     else
                        "onyx-watch-icon-btn onyx-watch-open"
                    )
                , href url
                , target "_blank"
                , rel "noopener noreferrer"
                , attribute "referrerpolicy" "no-referrer"
                , attribute "aria-label" ("Open " ++ host ++ " in a new tab")
                , attribute "title" url
                , attribute "data-testid"
                    (if wide then
                        "watch-open-wide"

                     else
                        "watch-open"
                    )
                ]
                (if wide then
                    [ icon "watch-open", span [] [ text ("Open " ++ host) ] ]

                 else
                    [ icon "watch-open" ]
                )

        Nothing ->
            text ""


progressTrack : View -> Html Msg
progressTrack v =
    case ( v.a.duration, v.position ) of
        ( Just d, Just p ) ->
            if d > 0 then
                div [ class "onyx-watch-track", attribute "aria-hidden" "true" ]
                    [ span
                        [ class "onyx-watch-fill"
                        , style "width" (String.fromFloat (toFloat (round (toFloat (clamp 0 d p) / toFloat d * 1000)) / 10) ++ "%")
                        ]
                        []
                    ]

            else
                text ""

        _ ->
            text ""



-- ── details ────────────────────────────────────────────────────────────


details : View -> Html Msg
details v =
    div
        [ class "onyx-watch-details"
        , id "watch-details"
        , attribute "data-testid" "watch-details"
        ]
        [ div [ class "onyx-watch-col onyx-watch-col-main" ]
            [ seekRow v
            , metaRow v
            , roster v
            , actions v
            , endRow v
            ]
        , div [ class "onyx-watch-col onyx-watch-col-side" ]
            [ linkRow v
            , p [ class "onyx-watch-honest" ]
                [ text
                    ("Onyx shares this title, link and a play/pause clock with everyone in "
                        ++ v.channel
                        ++ ". It doesn't stream, embed or control the video: open the link on your own device and match the time."
                    )
                ]
            , button
                [ type_ "button"
                , class "onyx-watch-text-btn onyx-watch-hide"
                , attribute "data-testid" "watch-hide"
                , onClick (wrap WT.Hide)
                ]
                [ text "Hide watch together on this device" ]
            ]
        ]

seekRow : View -> Html Msg
seekRow v =
    case v.rev of
        Just rev ->
            if v.host && v.writable && v.a.state /= WT.Handoff then
                div [ class "onyx-watch-seek", attribute "role" "group", attribute "aria-label" "Move the shared position" ]
                    ([ button
                        [ type_ "button"
                        , class "onyx-watch-btn onyx-watch-nudge"
                        , attribute "aria-label" "Back 10 seconds for everyone"
                        , attribute "data-testid" "watch-back"
                        , onClick (wrap (WT.Nudge rev -10))
                        ]
                        [ text "−10s" ]
                     ]
                        ++ (case v.a.duration of
                                Just d ->
                                    [ input
                                        [ type_ "range"
                                        , class "onyx-watch-range"
                                        , Html.Attributes.min "0"
                                        , Html.Attributes.max (String.fromInt d)
                                        , Html.Attributes.step "1"
                                        , value (String.fromInt (Maybe.withDefault 0 v.position))
                                        , attribute "aria-label" "Shared position"
                                        , attribute "aria-valuetext" (WT.formatClock v.position ++ " of " ++ WT.formatClock (Just d))
                                        , attribute "data-testid" "watch-seek"
                                        , onInput (wrap << WT.Scrub)
                                        , on "change" (Decode.map (wrap << WT.SeekTo rev) (Decode.at [ "target", "value" ] Decode.string))
                                        ]
                                        []
                                    ]

                                Nothing ->
                                    [ span [ class "onyx-watch-seek-gap" ] [] ]
                           )
                        ++ [ button
                                [ type_ "button"
                                , class "onyx-watch-btn onyx-watch-nudge"
                                , attribute "aria-label" "Forward 10 seconds for everyone"
                                , attribute "data-testid" "watch-forward"
                                , onClick (wrap (WT.Nudge rev 10))
                                ]
                                [ text "+10s" ]
                           ]
                    )

            else
                text ""

        Nothing ->
            text ""


metaRow : View -> Html Msg
metaRow v =
    let
        count =
            List.length v.a.participants

        hostWords =
            case v.a.host of
                Just h ->
                    [ text "Hosted by "
                    , strong [ class "onyx-watch-host" ]
                        [ text
                            (if v.host then
                                h ++ " (you)"

                             else
                                h
                            )
                        ]
                    ]
                        ++ (if WT.hostPresent v.ctx v.channel v.a then
                                []

                            else
                                [ span [ class "onyx-watch-away" ] [ text " · not in the room" ] ]
                           )

                Nothing ->
                    [ text "No host" ]
    in
    div [ class "onyx-watch-meta" ]
        [ p [ class "onyx-watch-hosted" ] hostWords
        , button
            [ type_ "button"
            , class "onyx-watch-text-btn onyx-watch-roster-toggle"
            , attribute "aria-expanded" (boolAttr v.w.rosterOpen)
            , attribute "aria-controls" "watch-roster"
            , attribute "data-testid" "watch-roster-toggle"
            , onClick (wrap WT.ToggleRoster)
            ]
            [ icon "people"
            , text
                ((if v.w.rosterOpen then
                    "Hide "

                  else
                    "Show "
                 )
                    ++ String.fromInt count
                    ++ (if count == 1 then
                            " participant"

                        else
                            " participants"
                       )
                )
            ]
        ]


roster : View -> Html Msg
roster v =
    if not v.w.rosterOpen then
        text ""

    else
        let
            entries =
                WT.rosterEntries v.self v.a
        in
        div
            [ class "onyx-watch-roster"
            , id "watch-roster"
            , attribute "role" "region"
            , attribute "aria-label" ("Watch participants (" ++ String.fromInt (List.length entries) ++ ")")
            ]
            [ if List.isEmpty entries then
                p [ class "onyx-watch-empty" ] [ text "No participants are listed for this activity." ]

              else
                ul [ class "onyx-watch-roster-list", attribute "aria-label" "Participant roster" ]
                    (List.map
                        (\e ->
                            li [ class "onyx-watch-person" ]
                                ([ span [ class "onyx-watch-person-nick" ] [ text e.nick ] ]
                                    ++ (if List.isEmpty e.labels then
                                            []

                                        else
                                            [ span [ class "onyx-watch-person-role" ] [ text (String.join " · " e.labels) ] ]
                                       )
                                )
                        )
                        entries
                    )
            ]


actions : View -> Html Msg
actions v =
    case ( v.rev, v.self ) of
        ( Just rev, Just self ) ->
            let
                clock =
                    WT.clockFor v.ctx.nowMs v.w.anchors v.channel v.raw v.a

                full =
                    WT.joinBlocked clock self v.a

                targetOffer =
                    v.a.state == WT.Handoff && (Maybe.map lower v.a.handoffTo == Just (lower self))

                hostAbsent =
                    v.a.host == Nothing || not (WT.hostPresent v.ctx v.channel v.a)

                pressed msg label testId primary disabledWhy =
                    button
                        [ type_ "button"
                        , class "onyx-watch-btn"
                        , classList [ ( "onyx-watch-btn-primary", primary ) ]
                        , attribute "aria-disabled" (boolAttr (v.busy || disabledWhy /= Nothing))
                        , attribute "data-testid" testId
                        , onClick
                            (if disabledWhy /= Nothing then
                                wrap WT.DismissNotice

                             else
                                wrap msg
                            )
                        ]
                        [ text label ]

                note words =
                    p [ class "onyx-watch-note" ] [ text words ]

                participantPart =
                    if v.host then
                        [ note "You are hosting. Hand hosting to someone else before you leave." ]

                    else if not v.writable then
                        [ note
                            (if v.ctx.online then
                                "Only room operators can join or control this activity on Onyx Server. You can still follow the clock and open the link."

                             else
                                "Offline: showing the last clock this device saw."
                            )
                        ]

                    else if v.participant then
                        [ pressed (WT.Leave rev) "Leave" "watch-leave-button" False Nothing ]

                    else if full then
                        [ pressed (WT.Join rev) "Activity full" "watch-join-button" False (Just "full")
                        , note "This activity has no room for another name."
                        ]

                    else
                        [ pressed (WT.Join rev) "Join" "watch-join-button" True Nothing ]

                acceptPart =
                    if targetOffer then
                        if v.writable then
                            [ note (Maybe.withDefault "The host" v.a.host ++ " offered you hosting.")
                            , pressed (WT.Accept rev) "Accept hosting" "watch-accept" True Nothing
                            ]

                        else
                            [ note "You were offered hosting, but accepting needs room operator rights." ]

                    else
                        []

                claimPart =
                    if v.writable && not v.host && hostAbsent then
                        [ pressed (WT.Claim rev) "Take over hosting" "watch-claim" False Nothing ]

                    else
                        []

                hostPart =
                    if v.host && v.writable then
                        if v.a.state == WT.Handoff then
                            [ note ("Waiting for " ++ Maybe.withDefault "them" v.a.handoffTo ++ " to accept hosting. Playback is paused.")
                            , pressed (WT.CancelOffer rev) "Cancel handoff" "watch-cancel-handoff" False Nothing
                            ]

                        else
                            handoffPicker v rev

                    else
                        []
            in
            div [ class "onyx-watch-actions", attribute "role" "group", attribute "aria-label" "Your part in this activity" ]
                (acceptPart ++ participantPart ++ claimPart ++ hostPart)

        _ ->
            div [ class "onyx-watch-actions" ]
                [ p [ class "onyx-watch-note" ] [ text "Sign in to take part. You can still follow the clock." ] ]


handoffPicker : View -> WT.Rev -> List (Html Msg)
handoffPicker v rev =
    let
        targets =
            WT.handoffTargets (v.ctx.isOperator v.channel) v.a

        chosen =
            case List.filter (\t -> lower t == lower v.w.handoffChoice) targets of
                t :: _ ->
                    t

                [] ->
                    Maybe.withDefault "" (List.head targets)
    in
    if List.isEmpty targets then
        [ p [ class "onyx-watch-note" ]
            [ text "To hand over hosting, another room operator needs to join first." ]
        ]

    else
        [ div [ class "onyx-watch-handoff" ]
            [ label [ class "onyx-watch-handoff-label", for "watch-handoff-target" ] [ text "New host" ]
            , select
                [ class "onyx-watch-select"
                , id "watch-handoff-target"
                , attribute "data-testid" "watch-handoff-target"
                , onInput (wrap << WT.ChooseHandoff)
                ]
                (List.map (\t -> option [ value t, selected (t == chosen) ] [ text t ]) targets)
            , button
                [ type_ "button"
                , class "onyx-watch-btn"
                , attribute "aria-disabled" (boolAttr v.busy)
                , attribute "data-testid" "watch-offer"
                , onClick (wrap (WT.Offer rev))
                ]
                [ text "Offer hosting" ]
            ]
        ]


endRow : View -> Html Msg
endRow v =
    case v.rev of
        Just rev ->
            if WT.canEnd v.ctx v.channel v.a then
                case v.w.endConfirm of
                    Just staged ->
                        if staged.raw == v.raw then
                            div
                                [ class "onyx-watch-confirm"
                                , attribute "role" "group"
                                , attribute "aria-labelledby" "watch-end-question"
                                , attribute "data-testid" "watch-end-confirmation"
                                ]
                                [ p [ class "onyx-watch-confirm-q", id "watch-end-question" ]
                                    [ strong [] [ text ("End “" ++ v.a.title ++ "”?") ]
                                    , text
                                        (" It disappears for "
                                            ++ (let
                                                    n =
                                                        List.length v.a.participants
                                                in
                                                String.fromInt n
                                                    ++ (if n == 1 then
                                                            " participant"

                                                        else
                                                            " participants"
                                                       )
                                               )
                                            ++ " and everyone in "
                                            ++ v.channel
                                            ++ "."
                                        )
                                    ]
                                , div [ class "onyx-watch-confirm-actions" ]
                                    [ button
                                        [ type_ "button"
                                        , class "onyx-watch-btn onyx-watch-btn-danger"
                                        , id "watch-end-confirm"
                                        , attribute "data-testid" "watch-end-confirm"
                                        , onClick (wrap (WT.ConfirmEnd rev))
                                        ]
                                        [ text "End for everyone" ]
                                    , button
                                        [ type_ "button"
                                        , class "onyx-watch-btn"
                                        , attribute "data-testid" "watch-end-cancel"
                                        , onClick (wrap WT.CancelEnd)
                                        ]
                                        [ text "Keep it running" ]
                                    ]
                                ]

                        else
                            endTrigger v rev

                    Nothing ->
                        endTrigger v rev

            else
                text ""

        Nothing ->
            text ""


endTrigger : View -> WT.Rev -> Html Msg
endTrigger v rev =
    div [ class "onyx-watch-end-row" ]
        [ button
            [ type_ "button"
            , class "onyx-watch-text-btn onyx-watch-end"
            , id "watch-end"
            , attribute "aria-disabled" (boolAttr v.busy)
            , attribute "data-testid" "watch-end-button"
            , onClick (wrap (WT.AskEnd rev))
            ]
            [ text "End activity…" ]
        ]


linkRow : View -> Html Msg
linkRow v =
    case v.link of
        Just ( url, _ ) ->
            div [ class "onyx-watch-link" ]
                [ p [ class "onyx-watch-link-url" ]
                    [ span [ class "onyx-watch-link-label" ] [ text "Link" ]
                    , span [ class "onyx-watch-url" ] [ text url ]
                    ]
                , openLink v True
                ]

        Nothing ->
            p [ class "onyx-watch-note" ] [ text "No link was shared. Follow the clock with your own copy." ]



-- ── start editor ───────────────────────────────────────────────────────


startSheet : Model -> Html Msg
startSheet model =
    case model.watch.editor of
        Nothing ->
            text ""

        Just editor ->
            let
                reviewing =
                    case editor.step of
                        WT.Reviewing _ ->
                            True

                        WT.Editing ->
                            False
            in
            Sheet.view
                { scope = "watch-start"
                , label = Sheet.LabelledBy (Sheet.titleId "watch-start")
                , onClose = wrap WT.EditorClose
                , placement = Sheet.Center
                , layerClass = ""
                , panelClass = "onyx-watch-sheet"
                , backdropClass = ""
                , layerAttrs = []
                , modal = True
                , attrs = [ attribute "aria-describedby" "watch-start-desc", attribute "data-testid" "watch-start" ]
                }
                [ Sheet.headerWith
                    (Sheet.head
                        { scope = "watch-start"
                        , title =
                            if reviewing then
                                "Review before sharing"

                            else
                                "Watch together"
                        , closeLabel = "Close the watch together editor"
                        , onClose = wrap WT.EditorClose
                        }
                        |> (\h ->
                                { h
                                    | kicker = Just editor.channel
                                    , subtitle =
                                        Just
                                            (if reviewing then
                                                "Confirming shows this to everyone in " ++ editor.channel ++ "."

                                             else
                                                "Share a title, a link and a play/pause clock with " ++ editor.channel ++ ". Nothing is shared until you confirm."
                                            )
                                    , subtitleId = Just "watch-start-desc"
                                    , closeTestId = Just "watch-start-close"
                                }
                           )
                    )
                , case editor.step of
                    WT.Editing ->
                        editForm editor

                    WT.Reviewing staged ->
                        reviewPane model editor staged
                ]


fieldError : WT.Editor -> WT.Field -> Maybe String
fieldError editor which =
    case editor.error of
        Just ( f, msg ) ->
            if f == which then
                Just msg

            else
                Nothing

        Nothing ->
            Nothing


editForm : WT.Editor -> Html Msg
editForm editor =
    form
        [ class "onyx-watch-form"
        , attribute "novalidate" ""
        , attribute "aria-label" "Start a watch activity"
        , onSubmit (wrap WT.EditorReview)
        ]
        [ inputField
            { id_ = "watch-start-title"
            , label_ = "Title"
            , hint = Nothing
            , value_ = editor.title
            , onInput_ = wrap << WT.EditTitle
            , error = fieldError editor WT.TitleField
            , attrs =
                [ Sheet.autofocus "watch-start"
                , Html.Attributes.maxlength WT.maxTitleLength
                , placeholder "Movie night"
                , attribute "enterkeyhint" "next"
                ]
            }
        , inputField
            { id_ = "watch-start-url"
            , label_ = "Link (optional)"
            , hint = Just "An https:// or http:// page everyone opens themselves."
            , value_ = editor.url
            , onInput_ = wrap << WT.EditUrl
            , error = fieldError editor WT.UrlField
            , attrs =
                [ type_ "url"
                , attribute "inputmode" "url"
                , placeholder "https://"
                , attribute "autocapitalize" "off"
                , attribute "spellcheck" "false"
                , attribute "enterkeyhint" "next"
                ]
            }
        , inputField
            { id_ = "watch-start-duration"
            , label_ = "Length (optional)"
            , hint = Just "Shows how far along everyone is, e.g. 1:45:00 or 95 (minutes)."
            , value_ = editor.duration
            , onInput_ = wrap << WT.EditDuration
            , error = fieldError editor WT.DurationField
            , attrs = [ placeholder "1:45:00", attribute "enterkeyhint" "done" ]
            }
        , case fieldError editor WT.FormField of
            Just msg ->
                p [ class "onyx-watch-error onyx-watch-form-error", attribute "role" "alert" ] [ text msg ]

            Nothing ->
                text ""
        , div [ class "onyx-watch-sheet-actions" ]
            [ button [ type_ "submit", class "onyx-watch-btn onyx-watch-btn-primary", attribute "data-testid" "watch-start-review-button" ] [ text "Review" ]
            , button [ type_ "button", class "onyx-watch-btn", onClick (wrap WT.EditorClose) ] [ text "Cancel" ]
            ]
        ]


inputField :
    { id_ : String
    , label_ : String
    , hint : Maybe String
    , value_ : String
    , onInput_ : String -> Msg
    , error : Maybe String
    , attrs : List (Html.Attribute Msg)
    }
    -> Html Msg
inputField f =
    let
        hintId =
            f.id_ ++ "-hint"

        errorId =
            f.id_ ++ "-error"

        described =
            List.filterMap identity
                [ Maybe.map (\_ -> errorId) f.error
                , Maybe.map (\_ -> hintId) f.hint
                ]
    in
    div [ class "onyx-watch-field" ]
        ([ label [ class "onyx-watch-label", for f.id_ ] [ text f.label_ ] ]
            ++ (case f.hint of
                    Just h ->
                        [ p [ class "onyx-watch-hint", id hintId ] [ text h ] ]

                    Nothing ->
                        []
               )
            ++ [ input
                    ([ id f.id_
                     , class "onyx-watch-input"
                     , value f.value_
                     , onInput f.onInput_
                     , attribute "autocomplete" "off"
                     , attribute "aria-invalid" (boolAttr (f.error /= Nothing))
                     ]
                        ++ (if List.isEmpty described then
                                []

                            else
                                [ attribute "aria-describedby" (String.join " " described) ]
                           )
                        ++ f.attrs
                    )
                    []
               ]
            ++ (case f.error of
                    Just msg ->
                        [ p [ class "onyx-watch-error", id errorId, attribute "role" "alert" ] [ text msg ] ]

                    Nothing ->
                        []
               )
        )


reviewPane : Model -> WT.Editor -> WT.Activity -> Html Msg
reviewPane model editor staged =
    section
        [ class "onyx-watch-review"
        , attribute "aria-label" ("Review watch activity " ++ staged.title)
        , attribute "data-testid" "watch-start-review"
        ]
        [ dl [ class "onyx-watch-review-list" ]
            ([ dt [] [ text "Title" ]
             , dd [ class "onyx-watch-review-title" ] [ text staged.title ]
             , dt [] [ text "Link" ]
             , dd []
                (case staged.url of
                    Just url ->
                        [ strong [ class "onyx-watch-review-host" ] [ text (Maybe.withDefault url (WT.urlHost url)) ]
                        , span [ class "onyx-watch-url" ] [ text url ]
                        ]

                    Nothing ->
                        [ text "No link" ]
                )
             , dt [] [ text "Length" ]
             , dd []
                [ text
                    (case staged.duration of
                        Just d ->
                            WT.formatClock (Just d)

                        Nothing ->
                            "Not set"
                    )
                ]
             , dt [] [ text "Host" ]
             , dd [] [ text ("You (" ++ Maybe.withDefault model.ourNick staged.host ++ ")") ]
             ]
            )
        , p [ class "onyx-watch-honest" ]
            [ text "Onyx keeps a shared play/pause clock and shows this link. It never streams, embeds or controls the video: everyone opens the link on their own device." ]
        , case fieldError editor WT.FormField of
            Just msg ->
                p [ class "onyx-watch-error onyx-watch-form-error", attribute "role" "alert" ] [ text msg ]

            Nothing ->
                text ""
        , div [ class "onyx-watch-sheet-actions", attribute "role" "group", attribute "aria-label" "Confirm new watch activity" ]
            [ button
                [ type_ "button"
                , class "onyx-watch-btn onyx-watch-btn-primary"
                , id "watch-start-confirm"
                , attribute "data-testid" "watch-start-confirm"
                , onClick (wrap WT.EditorConfirm)
                ]
                [ text ("Start in " ++ editor.channel) ]
            , button
                [ type_ "button"
                , class "onyx-watch-btn"
                , id "watch-start-back"
                , onClick (wrap WT.EditorBack)
                ]
                [ text "Back to edit" ]
            ]
        ]
