module View.Prefs exposing (prefsSheet)

{-| Device Preferences sheet (oracle `src/shell/PreferencesPanel.tsx`),
opened from the You hub → This device → Preferences.

Ported categories: Display, Conversation, History & data, Import &
export, Accessibility (the oracle's `App & tools` is not ported). Look,
text size, density, and privacy switches stay on `/appearance` — the
Display pane links there instead of duplicating them. Message density
is a placeholder row here (owned by the density slice).

Every preference write goes through the existing folds:
`AppearanceSetPref` (storage + DOM apply), `SetVaultSearchMode`,
`RetentionKeepSelected` / `RetentionAgeSelected`, and the
`-- v3/prefs` folds in `App` for queued sends, drafts, and transfer.
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, button, div, h2, h3, li, nav, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, disabled, hidden, id, tabindex, type_)
import Html.Events exposing (onClick, preventDefaultOn)
import Json.Decode as Decode
import Nav
import Prefs
import PrefsPanel exposing (Category(..))
import Retention
import View.Sheet as Sheet


prefsSheet : Model -> Html Msg
prefsSheet model =
    if not model.prefsOpen then
        text ""

    else
        Sheet.view
            { scope = "prefs"
            , label = Sheet.LabelledBy "pref-sheet-title"
            , onClose = PrefsClose
            , placement = Sheet.Center
            , layerClass = ""
            , panelClass = "onyx-prefs"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "aria-describedby" "pref-sheet-desc", attribute "data-testid" "preferences-panel" ]
            }
                [ Sheet.headerWith
                    (Sheet.head { scope = "prefs", title = "Device preferences", closeLabel = "Close preferences", onClose = PrefsClose }
                        |> (\h ->
                                { h
                                    | titleId = Just "pref-sheet-title"
                                    , subtitle = Just "Local choices for this browser — applied live."
                                    , subtitleId = Just "pref-sheet-desc"
                                    , closeTestId = Just "preferences-close"
                                }
                           )
                    )
                , div [ class "onyx-prefs-body" ]
                    [ categoryNav model
                    , div [ class "pref-category-content", attribute "data-layout" "category-detail" ]
                        (List.map (categoryPanel model) PrefsPanel.categories)
                    ]
                ]


categoryNav : Model -> Html Msg
categoryNav model =
    div [ class "pref-category-nav" ]
        [ nav [ class "pref-category-nav__landmark", attribute "aria-label" "Preference categories" ]
            [ div
                [ class "pref-category-tabs"
                , attribute "role" "tablist"
                , attribute "aria-label" "Preference categories"
                , attribute "aria-orientation" "vertical"
                ]
                (List.map (categoryTab model) PrefsPanel.categories)
            ]
        , button
            [ type_ "button"
            , class "pref-reset pref-reset-all"
            , attribute "aria-label" "Reset to defaults"
            , onClick PrefsReset
            ]
            [ -- v3/rx-sheets: phones show the short word (the aria-label
              -- keeps the full name), so the category chips get the room
              span [ class "pref-reset-all__full" ] [ text "Reset to defaults" ]
            , span [ class "pref-reset-all__short", attribute "aria-hidden" "true" ] [ text "Reset" ]
            ]
        , span
            [ class "sr-only"
            , attribute "role" "status"
            , attribute "aria-label" "Reset confirmation"
            , attribute "aria-live" "polite"
            , attribute "aria-atomic" "true"
            ]
            [ text model.prefsResetAnnouncement ]
        ]


categoryTab : Model -> PrefsPanel.CategoryInfo -> Html Msg
categoryTab model info =
    let
        selected =
            model.prefsCategory == info.category
    in
    button
        [ type_ "button"
        , class "pref-category-tab"
        , attribute "role" "tab"
        , id ("pref-category-tab-" ++ info.id)
        , attribute "aria-controls" ("pref-category-panel-" ++ info.id)
        , attribute "aria-label" info.label
        , attribute "aria-describedby" ("pref-category-summary-" ++ info.id)
        , attribute "aria-selected" (boolString selected)
        , tabindex
            (if selected then
                0

             else
                -1
            )
        , onClick (PrefsSelectCategory info.category)
        , preventDefaultOn "keydown"
            (Decode.field "key" Decode.string
                |> Decode.andThen
                    (\key ->
                        case PrefsPanel.categoryAfterKey info.category key of
                            Just _ ->
                                Decode.succeed ( PrefsCategoryKey { current = info.category, key = key }, True )

                            Nothing ->
                                Decode.fail "unhandled"
                    )
            )
        ]
        [ span [ class "pref-category-tab__label" ] [ text info.label ]
        , span [ class "pref-category-tab__summary", id ("pref-category-summary-" ++ info.id) ] [ text info.summary ]
        ]


categoryPanel : Model -> PrefsPanel.CategoryInfo -> Html Msg
categoryPanel model info =
    let
        active =
            model.prefsCategory == info.category
    in
    section
        [ class "pref-category-panel"
        , id ("pref-category-panel-" ++ info.id)
        , attribute "role" "tabpanel"
        , attribute "aria-labelledby" ("pref-category-tab-" ++ info.id)
        , hidden (not active)
        ]
        (if active then
            panelBody model info.category

         else
            []
        )


panelBody : Model -> Category -> List (Html Msg)
panelBody model category =
    case category of
        Display ->
            [ sectionHead "Display" "Reading rhythm and transcript behavior. For look, text size, and motion, open Appearance."
            , appearanceLauncher
            , section [ class "pref-group pref-placeholder", attribute "data-testid" "pref-density-placeholder" ]
                [ h3 [ class "pref-label" ] [ text "Message density" ]
                , p [ class "pref-desc" ] [ text "Compact, cozy, and roomy layouts are coming to this panel. Until then, set density in Appearance." ]
                ]
            , segmented
                { groupId = "pref-clock"
                , legend = "Clock"
                , description = "Timestamp format for messages and room activity."
                , options = [ ( "24h", "24-hour" ), ( "12h", "12-hour" ) ]
                , current = Prefs.clockToString model.prefs.clock
                , onSelect = \value -> AppearanceSetPref { key = "clock", value = value }
                }
            ]

        Conversation ->
            [ sectionHead "Conversation" "Attention level and optional room surfaces on this device."
            , toggle
                { key = "hideEvents"
                , legend = "System events"
                , title = "Hide join, part & quit"
                , description = "Removes the quiet system lines from the feed."
                , value = model.prefs.hideEvents
                }
            , section [ class "pref-group" ]
                [ h3 [ class "pref-label" ] [ text "Alerts" ]
                , p [ class "pref-desc" ] [ text "Desktop alerts, sound, do not disturb, keywords, and ignored people." ]
                , button
                    [ type_ "button"
                    , class "pref-reset"
                    , attribute "aria-haspopup" "dialog"
                    , onClick NotifySheetOpen
                    ]
                    [ text "Open notification settings" ]
                ]
            , section [ class "pref-group" ]
                [ h3 [ class "pref-label" ] [ text "Link previews and encrypted DMs" ]
                , p [ class "pref-desc" ] [ text "Preview, HTTPS-only, and end-to-end encryption switches live in Appearance under Privacy." ]
                ]
            ]

        History ->
            [ sectionHead "History & data" "How this browser remembers, finds, retains, and erases local conversation data."
            , segmented
                { groupId = "pref-vault-mode"
                , legend = "Default search mode"
                , description = "Which matching a device-memory search starts in: Text + related (literal matches, then token-similar terms), Exact (literal substring), or Related terms (token similarity only). All run in this browser — nothing is sent anywhere."
                , options = PrefsPanel.vaultSearchModeLabels
                , current = App.vaultSearchModeToString model.vaultSearchMode
                , onSelect = \value -> SetVaultSearchMode (App.parseVaultSearchMode value)
                }
            , retentionCard model
            , queuedCard model
            , draftsCard model
            ]

        Transfer ->
            [ sectionHead "Import & export" "Move portable conversation data into or out of this browser."
            , section [ class "pref-group pref-vault-portable", attribute "aria-labelledby" "pref-vault-portable-title" ]
                [ div [ class "pref-group-head" ]
                    [ h3 [ class "pref-label", id "pref-vault-portable-title" ] [ text "Portable vault" ] ]
                , p [ class "pref-desc" ]
                    [ text "Export or merge this device's local message history as portable JSON. Passwords, session tokens, and decrypted DM plaintext are not exported." ]
                , div [ class "pref-actions" ]
                    [ button [ type_ "button", class "pref-reset", onClick PrefsVaultExport ] [ text "Export vault" ]
                    , button [ type_ "button", class "pref-reset", onClick PrefsVaultImport ] [ text "Import portable JSON" ]
                    ]
                , case model.prefsTransferStatus of
                    Just status ->
                        p [ class "pref-status", attribute "role" "status" ] [ text status ]

                    Nothing ->
                        text ""
                ]
            ]

        Accessibility ->
            [ sectionHead "Accessibility" "Motion, transparency, contrast, and verified access surfaces on this device."
            , segmented
                { groupId = "pref-scene-motion"
                , legend = "Background motion"
                , description = "Animate the scene, freeze it on a still frame, or turn it off — independent of your OS motion setting."
                , options = [ ( "adaptive", "Adaptive" ), ( "animated", "Animated" ), ( "still", "Still" ), ( "off", "Off" ) ]
                , current = Prefs.sceneMotionToString model.sceneMotion
                , onSelect = PrefsSetSceneMotion
                }
            , toggle
                { key = "reduceMotion"
                , legend = "Motion"
                , title = "Reduce motion"
                , description = "Force-disable animations regardless of your OS setting."
                , value = model.prefs.reduceMotion
                }
            , toggle
                { key = "reduceTransparency"
                , legend = "Transparency"
                , title = "Reduce transparency"
                , description = "Flatten glassy overlays and translucent panels for stronger separation from the background."
                , value = model.prefs.reduceTransparency
                }
            , toggle
                { key = "highContrast"
                , legend = "Contrast"
                , title = "Raise interface contrast"
                , description = "Strengthens text, borders, focus outlines, and panel separation across the active theme."
                , value = model.prefs.highContrast
                }
            ]


sectionHead : String -> String -> Html Msg
sectionHead title description =
    div [ class "pref-section-head" ]
        [ h3 [ class "pref-section-title" ] [ text title ]
        , p [ class "pref-desc" ] [ text description ]
        ]


appearanceLauncher : Html Msg
appearanceLauncher =
    section [ class "pref-group pref-appearance-entry" ]
        [ button
            [ type_ "button"
            , class "pref-action-card"
            , attribute "aria-label" "Open appearance settings"
            , attribute "data-testid" "pref-open-appearance"
            , onClick (YouHubGo Nav.YouAppearance)
            ]
            [ span [ class "pref-action-card__icon", attribute "aria-hidden" "true" ] []
            , span [ class "pref-action-card__body" ]
                [ strong [ class "pref-action-card__title" ] [ text "Appearance" ]
                , span [ class "pref-desc" ] [ text "Choose a look, text size, and motion." ]
                ]
            ]
        ]


toggle : { key : String, legend : String, title : String, description : String, value : Bool } -> Html Msg
toggle t =
    let
        descId =
            "pref-toggle-desc-" ++ t.key
    in
    section [ class "pref-group" ]
        [ h3 [ class "pref-label" ] [ text t.legend ]
        , button
            [ type_ "button"
            , class "pref-toggle"
            , attribute "role" "switch"
            , attribute "aria-checked" (boolString t.value)
            , attribute "aria-label" t.title
            , attribute "aria-describedby" descId
            , attribute "data-testid" ("pref-toggle-" ++ t.key)
            , onClick (PrefsTogglePref t.key)
            ]
            [ span [ class "pref-toggle-text" ]
                [ span [ class "pref-toggle-title" ] [ text t.title ]
                , span [ class "pref-desc", id descId ] [ text t.description ]
                ]
            , span [ class "pref-switch", attribute "aria-hidden" "true" ] []
            ]
        ]


segmented :
    { groupId : String
    , legend : String
    , description : String
    , options : List ( String, String )
    , current : String
    , onSelect : String -> Msg
    }
    -> Html Msg
segmented s =
    let
        descId =
            s.groupId ++ "-desc"

        values =
            List.map Tuple.first s.options

        radioId value =
            s.groupId ++ "-" ++ value
    in
    section [ class "pref-group" ]
        [ div [ class "pref-group-head" ] [ h3 [ class "pref-label" ] [ text s.legend ] ]
        , p [ class "pref-desc", id descId ] [ text s.description ]
        , div
            [ class "pref-segments"
            , attribute "role" "radiogroup"
            , attribute "aria-label" s.legend
            , attribute "aria-describedby" descId
            , attribute "data-testid" s.groupId
            ]
            (List.map
                (\( value, label ) ->
                    let
                        active =
                            value == s.current
                    in
                    button
                        [ type_ "button"
                        , class "pref-segment"
                        , id (radioId value)
                        , attribute "role" "radio"
                        , attribute "aria-checked" (boolString active)
                        , tabindex
                            (if active then
                                0

                             else
                                -1
                            )
                        , onClick (s.onSelect value)
                        , preventDefaultOn "keydown"
                            (Decode.field "key" Decode.string
                                |> Decode.andThen
                                    (\key ->
                                        case PrefsPanel.segmentAfterKey values value key of
                                            Just next ->
                                                Decode.succeed ( PrefsSegmentKey { focusId = radioId next } (s.onSelect next), True )

                                            Nothing ->
                                                Decode.fail "unhandled"
                                    )
                            )
                        ]
                        [ text label ]
                )
                s.options
            )
        ]


retentionCard : Model -> Html Msg
retentionCard model =
    let
        policy =
            model.retentionPolicy

        ageIds =
            List.map ageId Retention.ageOptions

        ageId opt =
            case opt of
                Nothing ->
                    "none"

                Just days ->
                    String.fromFloat days

        ageCurrent =
            let
                raw =
                    ageId policy.maxAgeDays
            in
            if List.member raw ageIds then
                raw

            else
                "none"
    in
    section [ class "pref-group pref-vault-retention", attribute "aria-labelledby" "pref-vault-retention-title" ]
        [ div [ class "pref-group-head" ]
            [ h3 [ class "pref-label", id "pref-vault-retention-title" ] [ text "On-device history" ]
            , span [ class "pref-count" ] [ text "This device" ]
            ]
        , p [ class "pref-desc" ]
            [ text "Choose how much recent history this browser keeps for fast opening, offline reading, and device-memory search. Older messages are pruned automatically. Encrypted DM plaintext is never stored." ]
        , segmented
            { groupId = "pref-retention-keep"
            , legend = "Messages per conversation"
            , description = "The newest messages retained for each room or DM on this device."
            , options = List.map (\keep -> ( String.fromInt keep, Retention.keepLabels keep )) Retention.keepOptions
            , current = String.fromInt policy.keep
            , onSelect = RetentionKeepSelected
            }
        , segmented
            { groupId = "pref-retention-age"
            , legend = "Maximum local age"
            , description = "Also prune messages older than this age, even when the message limit has room."
            , options = List.map (\opt -> ( ageId opt, Retention.ageLabels opt )) Retention.ageOptions
            , current = ageCurrent
            , onSelect = RetentionAgeSelected
            }
        , p [ class "pref-desc" ]
            [ text "This changes only Onyx's private vault in this browser. It does not change server history or a room's EPHEMERAL retention setting." ]
        , case model.retentionStatus of
            Just status ->
                p [ class "pref-status", attribute "role" "status" ] [ text status ]

            Nothing ->
                text ""
        ]


queuedCard : Model -> Html Msg
queuedCard model =
    let
        count =
            List.length model.outbox
    in
    section [ class "pref-group pref-clear-history", attribute "aria-labelledby" "pref-discard-queued-title", attribute "data-testid" "pref-queued" ]
        [ div [ class "pref-group-head" ]
            [ h3 [ class "pref-label", id "pref-discard-queued-title" ] [ text "Queued sends" ]
            , span [ class "pref-count" ] [ text (PrefsPanel.countLabel count "queued send") ]
            ]
        , p [ class "pref-desc" ]
            [ text "Discard messages composed while offline without sending them. This removes only queued unsent text; vault history and drafts remain." ]
        , if List.isEmpty model.outbox then
            text ""

          else
            ul [ class "pref-rows", attribute "aria-label" "Queued sends" ]
                (List.map
                    (\row ->
                        li [ class "pref-row" ]
                            [ span [ class "pref-row-copy" ]
                                [ strong [] [ text row.target ]
                                , span [ class "pref-row-preview" ] [ text (preview row.text) ]
                                ]
                            , button
                                [ type_ "button"
                                , class "pref-row-action"
                                , attribute "aria-label" ("Discard queued send to " ++ row.target)
                                , disabled model.prefsOutboxBusy
                                , onClick (PrefsOutboxRemove row.id)
                                ]
                                [ text "Discard" ]
                            ]
                    )
                    model.outbox
                )
        , case model.prefsOutboxConfirm of
            Nothing ->
                div [ class "pref-actions" ]
                    [ button
                        [ type_ "button"
                        , class "pref-reset pref-reset--danger"
                        , id "pref-discard-queued-trigger"
                        , disabled (model.prefsOutboxBusy || count == 0)
                        , onClick PrefsOutboxDiscardAsk
                        ]
                        [ text "Discard queued sends" ]
                    ]

            Just staged ->
                div [ class "pref-confirm", attribute "role" "group", attribute "aria-label" "Confirm discard queued sends" ]
                    [ p [ class "pref-desc" ]
                        [ text ("Discard " ++ PrefsPanel.countLabel staged "queued send" ++ "? Their unsent message text will be removed from this device and will not be sent.") ]
                    , div [ class "pref-actions" ]
                        [ button
                            [ type_ "button"
                            , class "pref-reset pref-reset--danger"
                            , id "pref-discard-queued-confirm"
                            , disabled model.prefsOutboxBusy
                            , onClick PrefsOutboxDiscardConfirm
                            ]
                            [ text "Discard all queued sends" ]
                        , button
                            [ type_ "button"
                            , class "pref-reset"
                            , disabled model.prefsOutboxBusy
                            , onClick PrefsOutboxDiscardCancel
                            ]
                            [ text "Keep queued sends" ]
                        ]
                    ]
        , statusLine model.prefsOutboxStatus
        ]


draftsCard : Model -> Html Msg
draftsCard model =
    let
        drafts =
            App.prefsRoomDrafts model

        count =
            List.length drafts
    in
    section [ class "pref-group pref-clear-history", attribute "aria-labelledby" "pref-discard-drafts-title", attribute "data-testid" "pref-drafts" ]
        [ div [ class "pref-group-head" ]
            [ h3 [ class "pref-label", id "pref-discard-drafts-title" ] [ text "Local drafts" ]
            , span [ class "pref-count" ] [ text (PrefsPanel.countLabel count "room draft") ]
            ]
        , p [ class "pref-desc" ]
            [ text "Discard unsent room composer drafts on this device. Direct-message drafts are not counted here and remain. Messages, vault history, and queued sends are not changed." ]
        , if List.isEmpty drafts then
            text ""

          else
            ul [ class "pref-rows", attribute "aria-label" "Room drafts" ]
                (List.map
                    (\( target, draft ) ->
                        li [ class "pref-row" ]
                            [ span [ class "pref-row-copy" ]
                                [ strong [] [ text target ]
                                , span [ class "pref-row-preview" ] [ text (preview draft) ]
                                ]
                            , button
                                [ type_ "button"
                                , class "pref-row-action"
                                , attribute "aria-label" ("Discard draft in " ++ target)
                                , onClick (PrefsDraftDiscard target)
                                ]
                                [ text "Discard" ]
                            ]
                    )
                    drafts
                )
        , case model.prefsDraftsConfirm of
            Nothing ->
                div [ class "pref-actions" ]
                    [ button
                        [ type_ "button"
                        , class "pref-reset pref-reset--danger"
                        , id "pref-discard-drafts-trigger"
                        , disabled (count == 0)
                        , onClick PrefsDraftsDiscardAsk
                        ]
                        [ text "Discard local drafts" ]
                    ]

            Just staged ->
                div [ class "pref-confirm", attribute "role" "group", attribute "aria-label" "Confirm discard local drafts" ]
                    [ p [ class "pref-desc" ]
                        [ text ("Discard " ++ PrefsPanel.countLabel staged "room draft" ++ "? Their unsent text will be removed from this device. Direct-message drafts remain.") ]
                    , div [ class "pref-actions" ]
                        [ button
                            [ type_ "button"
                            , class "pref-reset pref-reset--danger"
                            , id "pref-discard-drafts-confirm"
                            , onClick PrefsDraftsDiscardConfirm
                            ]
                            [ text "Discard room drafts" ]
                        , button
                            [ type_ "button"
                            , class "pref-reset"
                            , onClick PrefsDraftsDiscardCancel
                            ]
                            [ text "Keep local drafts" ]
                        ]
                    ]
        , statusLine model.prefsDraftsStatus
        ]


statusLine : Maybe PrefsPanel.Status -> Html Msg
statusLine status =
    case status of
        Just s ->
            p
                [ class "pref-status"
                , attribute "role"
                    (if s.failure then
                        "alert"

                     else
                        "status"
                    )
                ]
                [ text s.message ]

        Nothing ->
            text ""


preview : String -> String
preview body =
    let
        flat =
            String.join " " (String.words body)
    in
    if String.length flat > 60 then
        String.left 59 flat ++ "…"

    else
        flat


boolString : Bool -> String
boolString b =
    if b then
        "true"

    else
        "false"
