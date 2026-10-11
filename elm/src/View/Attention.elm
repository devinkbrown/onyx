module View.Attention exposing
    ( digest
    , digestHead
    , digestLine
    , homeMemoryNote
    , presetSection
    , quietSection
    , readerAttr
    , readerPill
    , smartMuteSection
    )

{-| v3/gap-organize — the attention surfaces: quiet hours, the
notification preset and smart mute (Notifications sheet), the "Since
you left" digest on Home, the offline "On this device" note, and
reader mode's exit control + frame flag.

Policy lives in `Attention`; state in `App.Model.organize`; every
control dispatches `OrganizeMsg` (reader mode reuses the existing
`PrefsTogglePref "readerMode"` fold, so storage + DOM apply stay put).
-}

import App exposing (Model, Msg(..))
import Attention
import Dict
import Html exposing (Html, button, div, form, h3, label, option, p, section, select, span, strong, text, textarea)
import Html.Attributes exposing (attribute, class, classList, for, id, selected, tabindex, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit, preventDefaultOn, targetValue)
import Json.Decode as Decode
import Organize
import Organizer
import Prefs
import PrefsPanel
import Set


org : Organizer.Msg -> App.Msg
org =
    OrganizeMsg


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


twelveHour : Model -> Bool
twelveHour model =
    model.prefs.clock == Prefs.Clock12h



-- NOTIFICATIONS SHEET


{-| Quiet hours: a daily window when desktop and sound alerts stay
silent (unread badges and the inbox still fill in). -}
quietSection : Model -> Html Msg
quietSection model =
    let
        quiet =
            (orgOf model).quiet

        isOn =
            quiet.enabled

        hourSelect fieldId labelText current toMsg =
            div [ class "gorg-quiet-field" ]
                [ label [ class "notify-hint", for fieldId ] [ text labelText ]
                , select
                    [ id fieldId
                    , class "gorg-select"
                    , attribute "data-testid" fieldId
                    , on "change" (Decode.map (\v -> org (toMsg (Maybe.withDefault current (String.toInt v)))) targetValue)
                    ]
                    (List.map
                        (\h ->
                            option [ value (String.fromInt h), selected (h == current) ] [ text (Attention.hourLabel (twelveHour model) h) ]
                        )
                        (List.range 0 23)
                    )
                ]
    in
    section [ class "notify-group gorg-quiet", attribute "aria-label" "Quiet hours", attribute "data-testid" "notify-quiet" ]
        [ h3 [ class "notify-group-title" ] [ text "Quiet hours" ]
        , div [ class "notify-row" ]
            [ div [ class "notify-row-copy" ]
                [ span [ class "notify-row-title" ] [ text "Silence alerts every day" ]
                , span [ class "notify-row-hint", attribute "data-testid" "notify-quiet-status", attribute "role" "status" ]
                    [ text (Attention.quietStatus (twelveHour model) model.zone model.nowMs quiet) ]
                ]
            , button
                [ type_ "button"
                , class "notify-toggle"
                , attribute "aria-pressed" (boolAttr isOn)
                , attribute "aria-label"
                    (if isOn then
                        "Turn off quiet hours"

                     else
                        "Turn on quiet hours"
                    )
                , attribute "data-testid" "notify-quiet-toggle"
                , onClick (org Organizer.QuietToggle)
                ]
                [ text
                    (if isOn then
                        "On"

                     else
                        "Off"
                    )
                ]
            ]
        , if isOn then
            div [ class "gorg-quiet-range", attribute "role" "group", attribute "aria-label" "Quiet hours window" ]
                [ hourSelect "notify-quiet-start" "From" quiet.startHour Organizer.QuietStart
                , hourSelect "notify-quiet-end" "Until" quiet.endHour Organizer.QuietEnd
                ]

          else
            text ""
        , if isOn && quiet.startHour == quiet.endHour then
            p [ class "notify-hint gorg-warn", attribute "role" "status" ] [ text "Pick different start and end hours — an empty window never silences anything." ]

          else
            text ""
        ]


{-| Calm / Regular / Power — which kinds of activity may alert. -}
presetSection : Model -> Html Msg
presetSection model =
    let
        current =
            (orgOf model).preset

        values =
            List.map Attention.presetToString Attention.presets

        radioId p =
            "notify-preset-" ++ Attention.presetToString p
    in
    section [ class "notify-group gorg-preset", attribute "aria-label" "Notification mode", attribute "data-testid" "notify-preset" ]
        [ h3 [ class "notify-group-title", id "notify-preset-title" ] [ text "Notification mode" ]
        , div
            [ class "gorg-preset-options"
            , attribute "role" "radiogroup"
            , attribute "aria-labelledby" "notify-preset-title"
            ]
            (List.map
                (\preset ->
                    let
                        checked =
                            preset == current
                    in
                    button
                        [ type_ "button"
                        , class "gorg-preset-option"
                        , classList [ ( "gorg-preset-option--on", checked ) ]
                        , id (radioId preset)
                        , attribute "role" "radio"
                        , attribute "aria-checked" (boolAttr checked)
                        , attribute "data-testid" (radioId preset)
                        , tabindex
                            (if checked then
                                0

                             else
                                -1
                            )
                        , onClick (org (Organizer.PresetSet preset))
                        , preventDefaultOn "keydown"
                            (Decode.field "key" Decode.string
                                |> Decode.andThen
                                    (\key ->
                                        case PrefsPanel.segmentAfterKey values (Attention.presetToString current) key of
                                            Just next ->
                                                let
                                                    nextPreset =
                                                        Attention.parsePreset next
                                                in
                                                Decode.succeed ( PrefsSegmentKey { focusId = radioId nextPreset } (org (Organizer.PresetSet nextPreset)), True )

                                            Nothing ->
                                                Decode.fail "unhandled"
                                    )
                            )
                        ]
                        [ span [ class "gorg-preset-dot", attribute "aria-hidden" "true" ] []
                        , span [ class "gorg-preset-copy" ]
                            [ strong [] [ text (Attention.presetLabel preset) ]
                            , span [ class "notify-row-hint" ] [ text (Attention.presetDescription preset) ]
                            ]
                        ]
                )
                Attention.presets
            )
        ]


{-| Smart mute: words and people whose lines never ping you (the
messages still show in the room). -}
smartMuteSection : Model -> Html Msg
smartMuteSection model =
    let
        organize =
            (orgOf model)

        ready =
            Organizer.ready (App.deviceMemoryOwner model) model.organize
    in
    section [ class "notify-group gorg-smart", attribute "aria-label" "Smart mute", attribute "data-testid" "notify-smart-mute" ]
        [ h3 [ class "notify-group-title" ] [ text "Smart mute" ]
        , p [ class "notify-hint" ]
            [ text "Lines with these words or from these people never ping you. They still show in the room — use Ignore to hide someone." ]
        , form [ class "gorg-smart-form", onSubmit (org Organizer.SmartSave) ]
            [ label [ class "notify-hint gorg-field-label", for "notify-smart-words" ] [ text "Words and phrases (comma-separated)" ]
            , textarea
                [ id "notify-smart-words"
                , class "notify-input gorg-textarea"
                , attribute "rows" "2"
                , attribute "data-testid" "notify-smart-words"
                , attribute "placeholder" "crypto airdrop, free nitro"
                , value organize.smartKeywordsDraft
                , Html.Attributes.disabled (not ready)
                , onInput (org << Organizer.SmartKeywordsDraft)
                ]
                []
            , label [ class "notify-hint gorg-field-label", for "notify-smart-people" ] [ text "People (comma-separated names)" ]
            , textarea
                [ id "notify-smart-people"
                , class "notify-input gorg-textarea"
                , attribute "rows" "1"
                , attribute "data-testid" "notify-smart-people"
                , attribute "placeholder" "noisybot, deploy-bot"
                , value organize.smartNicksDraft
                , Html.Attributes.disabled (not ready)
                , onInput (org << Organizer.SmartNicksDraft)
                ]
                []
            , div [ class "gorg-smart-foot" ]
                [ span [ class "notify-hint", attribute "role" "status", attribute "data-testid" "notify-smart-status" ]
                    [ text
                        (case organize.smartStatus of
                            Just status ->
                                status

                            Nothing ->
                                if ready then
                                    Attention.smartMuteSummary organize.smartMute

                                else
                                    "Connect to change smart mute."
                        )
                    ]
                , button
                    [ type_ "submit"
                    , class "notify-add-btn"
                    , attribute "data-testid" "notify-smart-save"
                    , Html.Attributes.disabled (not ready)
                    ]
                    [ text "Save" ]
                ]
            ]
        ]



-- SINCE YOU LEFT (Home)


{-| The unread tail of every conversation that still has news (muted
DMs and rooms set to Mute are silent here too, unless they mention
you). -}
digest : Model -> Attention.Digest
digest model =
    let
        inputs =
            model.channels
                |> Dict.values
                |> List.filter
                    (\c ->
                        let
                            key =
                                String.toLower c.name

                            room =
                                App.isChannelName model c.name

                            silenced =
                                if room then
                                    App.notifyLevel model c.name == "none" && c.highlights == 0

                                else
                                    Set.member key model.mutedDMs
                        in
                        (c.unread > 0 || c.highlights > 0) && not silenced
                    )
                |> List.map
                    (\c ->
                        let
                            key =
                                String.toLower c.name

                            tail =
                                case Dict.get key model.firstUnreadId of
                                    Just first ->
                                        List.filter (\m -> m.id >= first) c.messages

                                    Nothing ->
                                        List.take c.unread c.messages
                        in
                        { name = c.name
                        , unread = c.unread
                        , highlights = c.highlights
                        , rows =
                            tail
                                |> List.filter (\m -> not m.deleted && not m.redacted && m.msgType /= "system")
                                |> List.take 400
                                |> List.map
                                    (\m ->
                                        { from = m.from
                                        , at = m.at
                                        , highlight = m.highlight
                                        , text =
                                            if m.plaintext /= Nothing || Organize.looksSealed m.body then
                                                Nothing

                                            else
                                                Just (App.displayBody m)
                                        }
                                    )
                        }
                    )
    in
    Attention.buildDigest { self = model.ourNick, maxRows = 24 } inputs


{-| "Since you left · 20:55–00:03 · 7 people wrote" (the counts are
already in the summary line above it). -}
digestHead : Model -> Attention.Digest -> Html Msg
digestHead model d =
    if d.rooms == 0 then
        text ""

    else
        p [ class "gorg-digest-head", attribute "data-testid" "home-digest", attribute "aria-label" ("Since you left: " ++ Attention.digestHeadline d) ]
            [ span [ class "gorg-digest-kicker" ] [ text "Since you left" ]
            , span [ class "gorg-digest-headline" ] [ text (Attention.digestSpan (App.formatRowClock model.zone model.prefs.clock) d) ]
            ]


{-| The per-conversation summary line under a Home row (who, when,
what about) — the row itself is the jump to the first unread line. -}
digestLine : Model -> Attention.Digest -> String -> Html Msg
digestLine model d name =
    let
        clock at =
            App.formatRowClock model.zone model.prefs.clock at
    in
    case List.filter (\r -> String.toLower r.name == String.toLower name) d.rows |> List.head of
        Just row ->
            let
                line =
                    Attention.digestRowLine clock row
            in
            if String.isEmpty line then
                text ""

            else
                span [ class "gorg-digest-line", attribute "data-testid" "home-digest-line" ] [ text line ]

        Nothing ->
            text ""


{-| While offline: what this device is holding until the connection
comes back (queued sends, drafts). -}
homeMemoryNote : Model -> Html Msg
homeMemoryNote model =
    if model.connection == App.Live then
        text ""

    else
        let
            queued =
                List.length model.outbox

            drafts =
                List.length (App.prefsRoomDrafts model)

            count n one =
                String.fromInt n
                    ++ " "
                    ++ one
                    ++ (if n == 1 then
                            ""

                        else
                            "s"
                       )

            waiting =
                List.filterMap identity
                    [ if queued > 0 then
                        Just (count queued "queued send")

                      else
                        Nothing
                    , if drafts > 0 then
                        Just (count drafts "draft")

                      else
                        Nothing
                    ]
        in
        p [ class "gorg-memory-note", attribute "role" "status", attribute "data-testid" "home-memory" ]
            [ text
                (if List.isEmpty waiting then
                    "On this device: your rooms, drafts and queued sends stay here until you reconnect."

                 else
                    "On this device: " ++ String.join " and " waiting ++ " waiting. They go out when you reconnect."
                )
            ]



-- READER MODE


{-| Reader mode is on and a conversation is showing. -}
readerOn : Model -> Bool
readerOn model =
    model.prefs.readerMode && model.activeChannel /= Nothing && not model.callsOpen


{-| `data-reader` on the app frame (CSS hides the rails and chrome). -}
readerAttr : Model -> Html.Attribute Msg
readerAttr model =
    attribute "data-reader" (boolAttr (readerOn model))


{-| The one way back out, always in reach while reading. -}
readerPill : Model -> Html Msg
readerPill model =
    if readerOn model then
        div [ class "gorg-reader-bar", attribute "role" "region", attribute "aria-label" "Reader mode" ]
            [ span [ class "gorg-reader-label" ] [ text "Reader mode" ]
            , button
                [ type_ "button"
                , class "gorg-reader-exit"
                , attribute "data-testid" "reader-exit"
                , onClick (PrefsTogglePref "readerMode")
                ]
                [ text "Exit" ]
            ]

    else
        text ""


{-| The organize memory for the live owner (empty until it loads). -}
orgOf : Model -> Organizer.State
orgOf model =
    Organizer.current (App.deviceMemoryOwner model) model.organize
