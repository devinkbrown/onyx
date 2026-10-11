module View.GapAccount exposing
    ( accountNavLinks
    , exportButton
    , exportReview
    , historyCards
    , namesSection
    , protectionSection
    , transferCards
    )

{-| v3/gap-account — Account protection (secure / enforce, recover and
release a name, recognised addresses, grouped names) and the
Preferences data controls (local history on/off + verified clear, saved
searches clear / export / import, portable-vault export review).

Every control routes through `GapAccountMsg`; the folds live in `App`
(`updateGapAccount`). Secrets: the protection password field is cleared
on every send and whenever the Account sheet closes.
-}

import App exposing (ConnectionState(..), Model)
import GapAccount exposing (Erase(..), Msg(..))
import HistoryImport
import Html exposing (Html, a, button, div, form, h3, input, label, li, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, href, id, maxlength, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import PrefsPanel


gap : GapAccount.Msg -> App.Msg
gap =
    App.GapAccountMsg


boolString : Bool -> String
boolString b =
    if b then
        "true"

    else
        "false"


statusLine : String -> Maybe { ok : Bool, text : String } -> Html App.Msg
statusLine testId status =
    case status of
        Nothing ->
            text ""

        Just s ->
            if s.ok then
                p [ class "gap-status", attribute "role" "status", attribute "data-testid" testId ] [ text s.text ]

            else
                p [ class "gap-status gap-status--error", attribute "role" "alert", attribute "data-testid" testId ] [ text s.text ]



-- ACCOUNT


{-| Section-nav entries for the two Account sections. -}
accountNavLinks : List (Html App.Msg)
accountNavLinks =
    [ a [ class "onyx-account-nav__item", href "#acct-protection-title" ] [ text "Protection" ]
    , a [ class "onyx-account-nav__item", href "#acct-names-title" ] [ text "Names" ]
    ]


switch : { key : String, title : String, description : String, value : Maybe Bool, busy : Bool } -> Html App.Msg
switch s =
    let
        descId =
            "acct-protect-desc-" ++ s.key

        current =
            Maybe.withDefault False s.value
    in
    button
        [ type_ "button"
        , class "pref-toggle gap-switch"
        , attribute "role" "switch"
        , attribute "aria-checked"
            (case s.value of
                Just True ->
                    "true"

                Just False ->
                    "false"

                Nothing ->
                    "mixed"
            )
        , attribute "aria-label" s.title
        , attribute "aria-describedby" descId
        , attribute "aria-busy" (boolString s.busy)
        , attribute "data-testid" ("account-protect-" ++ s.key)
        , disabled (s.busy || s.value == Nothing)
        , onClick (gap (ProtectToggle s.key (not current)))
        ]
        [ span [ class "pref-toggle-text" ]
            [ span [ class "pref-toggle-title" ] [ text s.title ]
            , span [ class "pref-desc", id descId ] [ text s.description ]
            ]
        , span [ class "pref-switch", attribute "aria-hidden" "true" ] []
        ]


{-| Account → Protection: "Require sign-in" (secure) and "Hold this
name" (enforce) over `ACCOUNTSET`, plus Recover / Release a name. -}
protectionSection : Model -> Html App.Msg
protectionSection model =
    let
        ga =
            model.gapAccount

        flags =
            case model.accountInfo of
                Just info ->
                    GapAccount.protectionState info

                Nothing ->
                    { secure = Nothing, enforce = Nothing }

        busy field =
            Maybe.map .field ga.protectPending == Just field

        live =
            model.connection == Live

        recoverBusy =
            ga.recoverPending /= Nothing

        account =
            Maybe.withDefault "" model.accountName
    in
    section [ class "onyx-account-section gap-acct", id "acct-protection-title", attribute "data-testid" "account-protection" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Protection" ]
        , p [ class "onyx-account-hint" ] [ text "Keep your name yours. Changing these needs your account password." ]
        , label [ class "onyx-account-field-label", for "acct-protect-password" ] [ text "Account password" ]
        , input
            [ class "onyx-account-field"
            , id "acct-protect-password"
            , type_ "password"
            , attribute "autocomplete" "current-password"
            , value ga.protectPassword
            , onInput (gap << ProtectPassword)
            , placeholder "needed to change a switch"
            , attribute "data-testid" "account-protect-password"
            ]
            []
        , div [ class "gap-switches" ]
            [ switch
                { key = "secure"
                , title = "Require sign-in"
                , description = "Only treat someone as you after they sign in. Recognised addresses can't stand in for your password."
                , value = flags.secure
                , busy = busy "secure" || not live
                }
            , switch
                { key = "enforce"
                , title = "Hold this name"
                , description = "Move a guest off your registered name after a short grace period."
                , value = flags.enforce
                , busy = busy "enforce" || not live
                }
            ]
        , if flags.secure == Nothing && flags.enforce == Nothing then
            p [ class "onyx-account-hint" ] [ text "Current settings haven't loaded yet." ]

          else
            text ""
        , case ga.protectPending of
            Just _ ->
                p [ class "gap-status", attribute "role" "status" ] [ text "Saving…" ]

            Nothing ->
                text ""
        , case ga.protectNotice of
            Just notice ->
                p [ class "gap-status", attribute "role" "status", attribute "data-testid" "account-protect-notice" ] [ text notice ]

            Nothing ->
                text ""
        , case ga.protectError of
            Just err ->
                p [ class "gap-status gap-status--error", attribute "role" "alert", attribute "data-testid" "account-protect-error" ] [ text err ]

            Nothing ->
                text ""
        , div [ class "gap-subsection", attribute "role" "group", attribute "aria-labelledby" "acct-recover-heading" ]
            [ strong [ class "gap-subhead", id "acct-recover-heading" ] [ text "Recover a name" ]
            , p [ class "onyx-account-hint" ]
                [ text "If a guest is using your registered name, take it back now instead of waiting for the grace period. You must be signed in to the account that owns the name." ]
            , form [ class "gap-inline-form", onSubmit (gap RecoverSubmit), attribute "aria-label" "Recover a name" ]
                [ label [ class "onyx-account-field-label", for "acct-recover-nick" ] [ text "Name" ]
                , div [ class "gap-inline-row" ]
                    [ input
                        [ class "onyx-account-field"
                        , id "acct-recover-nick"
                        , type_ "text"
                        , value ga.recoverNick
                        , maxlength 64
                        , onInput (gap << RecoverNickInput)
                        , placeholder account
                        , attribute "autocapitalize" "off"
                        , attribute "spellcheck" "false"
                        , attribute "data-testid" "account-recover-nick"
                        ]
                        []
                    ]
                , div [ class "onyx-account-actions gap-actions" ]
                    [ button
                        [ type_ "submit"
                        , class "gap-btn gap-btn--primary"
                        , disabled (recoverBusy || not live)
                        , attribute "data-testid" "account-recover"
                        ]
                        [ text "Take it back" ]
                    , button
                        [ type_ "button"
                        , class "gap-btn"
                        , disabled (recoverBusy || not live)
                        , onClick (gap ReleaseSubmit)
                        , attribute "data-testid" "account-release"
                        ]
                        [ text "Release hold" ]
                    ]
                , p [ class "onyx-account-hint" ] [ text "Release drops the short hold the server keeps after a recovery, so the name is free for anyone again." ]
                ]
            , statusLine "account-recover-status" ga.recoverStatus
            ]
        ]


{-| Account → Names: recognised addresses (`RECOGNIZE`) and grouped
names (`GROUP`). -}
namesSection : Model -> Html App.Msg
namesSection model =
    let
        ga =
            model.gapAccount

        live =
            model.connection == Live
    in
    section [ class "onyx-account-section gap-acct", id "acct-names-title", attribute "data-testid" "account-names" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Names & addresses" ]
        , div [ class "gap-subsection", attribute "role" "group", attribute "aria-labelledby" "acct-recognize-heading" ]
            [ div [ class "gap-subhead-row" ]
                [ strong [ class "gap-subhead", id "acct-recognize-heading" ] [ text "Recognised addresses" ]
                , button [ type_ "button", class "gap-btn gap-btn--quiet", disabled (not live || ga.recognizeLoading), onClick (gap RecognizeRefresh) ] [ text "Refresh" ]
                ]
            , p [ class "onyx-account-hint" ]
                [ text "A connection from one of these address patterns keeps your name without signing in. It gets no account access — that still needs your password." ]
            , if ga.recognizeLoading then
                p [ class "onyx-account-pending" ] [ text "Loading…" ]

              else if List.isEmpty ga.recognize then
                p [ class "gap-empty", attribute "data-testid" "account-recognize-empty" ] [ text "No recognised addresses." ]

              else
                ul [ class "gap-list", attribute "aria-label" "Recognised addresses", attribute "data-testid" "account-recognize-list" ]
                    (List.map
                        (\mask ->
                            li [ class "gap-list-row" ]
                                [ span [ class "gap-list-text", attribute "title" mask ] [ text mask ]
                                , span [ class "gap-list-actions" ]
                                    [ button
                                        [ type_ "button"
                                        , class "gap-btn gap-btn--quiet"
                                        , attribute "aria-label" ("Remove " ++ mask)
                                        , disabled (not live)
                                        , onClick (gap (RecognizeRemove mask))
                                        ]
                                        [ text "Remove" ]
                                    ]
                                ]
                        )
                        ga.recognize
                    )
            , form [ class "gap-inline-form", onSubmit (gap RecognizeAdd), attribute "aria-label" "Add a recognised address" ]
                [ label [ class "onyx-account-field-label", for "acct-recognize-add" ] [ text "Address pattern" ]
                , div [ class "gap-inline-row" ]
                    [ input
                        [ class "onyx-account-field"
                        , id "acct-recognize-add"
                        , type_ "text"
                        , value ga.recognizeDraft
                        , maxlength 255
                        , onInput (gap << RecognizeDraft)
                        , placeholder "nick!*@home.example"
                        , attribute "autocapitalize" "off"
                        , attribute "spellcheck" "false"
                        , attribute "data-testid" "account-recognize-input"
                        ]
                        []
                    , button [ type_ "submit", class "gap-btn", disabled (not live || String.isEmpty (String.trim ga.recognizeDraft)) ] [ text "Add" ]
                    ]
                ]
            , statusLine "account-recognize-status" ga.recognizeStatus
            ]
        , div [ class "gap-subsection", attribute "role" "group", attribute "aria-labelledby" "acct-group-heading" ]
            [ div [ class "gap-subhead-row" ]
                [ strong [ class "gap-subhead", id "acct-group-heading" ] [ text "Grouped names" ]
                , button [ type_ "button", class "gap-btn gap-btn--quiet", disabled (not live || ga.groupLoading), onClick (gap GroupRefresh) ] [ text "Refresh" ]
                ]
            , p [ class "onyx-account-hint" ]
                [ text "Extra names that belong to your account. The primary name is the one you're shown with." ]
            , if ga.groupLoading && List.isEmpty ga.groupNicks then
                p [ class "onyx-account-pending" ] [ text "Loading…" ]

              else if List.isEmpty ga.groupNicks then
                p [ class "gap-empty", attribute "data-testid" "account-group-empty" ] [ text "No grouped names yet." ]

              else
                ul [ class "gap-list", attribute "aria-label" "Grouped names", attribute "data-testid" "account-group-list" ]
                    (List.map
                        (\row ->
                            li
                                [ class
                                    (if row.primary then
                                        "gap-list-row"

                                     else
                                        "gap-list-row gap-list-row--multi"
                                    )
                                ]
                                [ span [ class "gap-list-text", attribute "title" row.nick ]
                                    [ text row.nick
                                    , if row.primary then
                                        span [ class "gap-badge" ] [ text "Primary" ]

                                      else
                                        text ""
                                    ]
                                , span [ class "gap-list-actions" ]
                                    [ if row.primary then
                                        text ""

                                      else
                                        button
                                            [ type_ "button"
                                            , class "gap-btn gap-btn--quiet"
                                            , attribute "aria-label" ("Make " ++ row.nick ++ " primary")
                                            , disabled (not live)
                                            , onClick (gap (GroupPrimary row.nick))
                                            ]
                                            [ text "Make primary" ]
                                    , if row.primary then
                                        -- make another name primary first
                                        text ""

                                      else
                                        button
                                            [ type_ "button"
                                            , class "gap-btn gap-btn--quiet"
                                            , attribute "aria-label" ("Remove " ++ row.nick ++ " from your group")
                                            , disabled (not live)
                                            , onClick (gap (GroupRemove row.nick))
                                            ]
                                            [ text "Remove" ]
                                    ]
                                ]
                        )
                        ga.groupNicks
                    )
            , form [ class "gap-inline-form", onSubmit (gap GroupAdd), attribute "aria-label" "Add a grouped name" ]
                [ label [ class "onyx-account-field-label", for "acct-group-add" ] [ text "Name" ]
                , div [ class "gap-inline-row" ]
                    [ input
                        [ class "onyx-account-field"
                        , id "acct-group-add"
                        , type_ "text"
                        , value ga.groupDraft
                        , maxlength 64
                        , onInput (gap << GroupDraft)
                        , placeholder "another-name"
                        , attribute "autocapitalize" "off"
                        , attribute "spellcheck" "false"
                        , attribute "data-testid" "account-group-input"
                        ]
                        []
                    , button [ type_ "submit", class "gap-btn", disabled (not live || String.isEmpty (String.trim ga.groupDraft)) ] [ text "Add" ]
                    ]
                ]
            , statusLine "account-group-status" ga.groupStatus
            ]
        ]



-- PREFERENCES


{-| History & data: local history switch, verified clear, and the
saved-search clear (all device-only). -}
historyCards : Model -> List (Html App.Msg)
historyCards model =
    let
        ga =
            model.gapAccount

        on =
            model.prefs.localHistory

        erasing =
            ga.erase == Erasing

        failed =
            ga.erase == EraseFailed

        searches =
            List.length model.savedSearches
    in
    [ section [ class "pref-group gap-history", attribute "aria-labelledby" "pref-local-history-title", attribute "data-testid" "pref-local-history" ]
        [ h3 [ class "pref-label", id "pref-local-history-title" ] [ text "Local history" ]
        , button
            [ type_ "button"
            , class "pref-toggle"
            , attribute "role" "switch"
            , attribute "aria-checked" (boolString on)
            , attribute "aria-label" "Remember conversations on this device"
            , attribute "aria-describedby" "pref-local-history-desc"
            , attribute "aria-busy" (boolString erasing)
            , attribute "data-testid" "pref-toggle-localHistory"
            , disabled erasing
            , onClick (gap (LocalHistorySet (not on)))
            ]
            [ span [ class "pref-toggle-text" ]
                [ span [ class "pref-toggle-title" ] [ text "Remember conversations on this device" ]
                , span [ class "pref-desc", id "pref-local-history-desc" ]
                    [ text "Keeps recent scrollback in this browser so rooms open instantly, read offline, and turn up in device search. Each account keeps its own. Turning it off erases what's stored here." ]
                ]
            , span [ class "pref-switch", attribute "aria-hidden" "true" ] []
            ]
        ]
    , section [ class "pref-group pref-clear-history", attribute "aria-labelledby" "pref-clear-local-title", attribute "data-testid" "pref-clear-history" ]
        [ div [ class "pref-group-head" ]
            [ h3 [ class "pref-label", id "pref-clear-local-title" ] [ text "Clear local history" ]
            , span [ class "pref-count" ] [ text "This browser" ]
            ]
        , p [ class "pref-desc" ]
            [ text "Erase every conversation saved in this browser, for every account that used it here. Server history, queued sends and scheduled messages are not affected." ]
        , if ga.clearConfirm then
            div [ class "pref-confirm", attribute "role" "group", attribute "aria-label" "Confirm clear local history" ]
                [ p [ class "pref-desc" ] [ text "Erase all saved conversations from this browser? This can't be undone." ]
                , div [ class "pref-actions" ]
                    [ button
                        [ type_ "button"
                        , class "pref-reset pref-reset--danger"
                        , id "pref-clear-history-confirm"
                        , attribute "data-testid" "pref-clear-history-confirm"
                        , disabled erasing
                        , onClick (gap HistoryClearConfirm)
                        ]
                        [ text "Erase local history" ]
                    , button [ type_ "button", class "pref-reset", onClick (gap HistoryClearCancel) ] [ text "Keep it" ]
                    ]
                ]

          else
            div [ class "pref-actions" ]
                [ button
                    [ type_ "button"
                    , class "pref-reset pref-reset--danger"
                    , id "pref-clear-history-trigger"
                    , attribute "data-testid" "pref-clear-history-trigger"
                    , disabled erasing
                    , onClick (gap HistoryClearAsk)
                    ]
                    [ text "Clear local history…" ]
                ]
        , case ga.historyStatus of
            Just status ->
                if failed then
                    div [ class "gap-status-block" ]
                        [ p [ class "pref-status pref-status--error", attribute "role" "alert", attribute "data-testid" "pref-history-status" ] [ text status ]
                        , div [ class "pref-actions" ]
                            [ button [ type_ "button", class "pref-reset", onClick (gap HistoryClearConfirm) ] [ text "Try erasing again" ] ]
                        ]

                else
                    p [ class "pref-status", attribute "role" "status", attribute "data-testid" "pref-history-status" ] [ text status ]

            Nothing ->
                text ""
        ]
    , section [ class "pref-group pref-clear-history", attribute "aria-labelledby" "pref-saved-searches-title", attribute "data-testid" "pref-saved-searches" ]
        [ div [ class "pref-group-head" ]
            [ h3 [ class "pref-label", id "pref-saved-searches-title" ] [ text "Saved searches" ]
            , span [ class "pref-count" ] [ text (GapAccount.savedSearchLabel searches) ]
            ]
        , p [ class "pref-desc" ] [ text "Searches you saved in this browser. Clearing removes them here only; export them first from Import & export if you want to keep them." ]
        , if ga.searchClearConfirm then
            div [ class "pref-confirm", attribute "role" "group", attribute "aria-label" "Confirm clear saved searches" ]
                [ p [ class "pref-desc" ] [ text ("Remove " ++ GapAccount.savedSearchLabel searches ++ " from this browser?") ]
                , div [ class "pref-actions" ]
                    [ button
                        [ type_ "button"
                        , class "pref-reset pref-reset--danger"
                        , attribute "data-testid" "pref-saved-searches-confirm"
                        , onClick (gap SearchClearConfirm)
                        ]
                        [ text "Clear saved searches" ]
                    , button [ type_ "button", class "pref-reset", onClick (gap SearchClearCancel) ] [ text "Keep them" ]
                    ]
                ]

          else
            div [ class "pref-actions" ]
                [ button
                    [ type_ "button"
                    , class "pref-reset pref-reset--danger"
                    , attribute "data-testid" "pref-saved-searches-clear"
                    , disabled (searches == 0)
                    , onClick (gap SearchClearAsk)
                    ]
                    [ text "Clear saved searches…" ]
                ]
        , searchStatusLine model
        ]
    ]


searchStatusLine : Model -> Html App.Msg
searchStatusLine model =
    case model.gapAccount.searchStatus of
        Just status ->
            p [ class "pref-status", attribute "role" "status", attribute "data-testid" "pref-saved-searches-status" ] [ text status ]

        Nothing ->
            text ""


{-| The Export vault button inside v3/gap-import's portable-vault card:
it asks for the export review first (`exportReview`) instead of
downloading at once. -}
exportButton : String -> Model -> Html App.Msg
exportButton cls model =
    button
        [ type_ "button"
        , class cls
        , attribute "data-testid" "pref-vault-export"
        , disabled model.gapAccount.exportConfirm
        , onClick (gap ExportAsk)
        ]
        [ text "Export vault" ]


{-| What a portable export contains, shown before anything downloads. -}
exportReview : Model -> Html App.Msg
exportReview model =
    if model.gapAccount.exportConfirm then
        div [ class "pref-confirm gap-review", attribute "role" "group", attribute "aria-label" "Review export", attribute "data-testid" "pref-export-review" ]
            [ strong [ class "gap-review-title" ] [ text "Before you download" ]
            , ul [ class "gap-review-facts" ]
                [ li [] [ text "Readable message text for every room and DM saved in this browser under your current sign-in." ]
                , li [] [ text "Encrypted DMs stay encrypted. Passwords and session tokens are never included." ]
                , li [] [ text "Anyone with the file can read it \u{2014} keep it private." ]
                ]
            , div [ class "pref-actions" ]
                [ button [ type_ "button", class "pref-reset gap-btn--primary", attribute "data-testid" "pref-export-confirm", onClick (gap ExportConfirm) ] [ text "Download export" ]
                , button [ type_ "button", class "pref-reset", onClick (gap ExportCancel) ] [ text "Cancel" ]
                ]
            ]

    else
        text ""


{-| Import & export: saved searches (the portable vault, its import
review and past imports are v3/gap-import's). Hidden while a review is
open so its sticky bar stays the last thing on the page. -}
transferCards : Model -> List (Html App.Msg)
transferCards model =
    case model.historyImport.phase of
        HistoryImport.Reviewing _ ->
            []

        _ ->
            [ section [ class "pref-group", attribute "aria-labelledby" "pref-saved-transfer-title", attribute "data-testid" "pref-saved-searches-transfer" ]
                [ div [ class "pref-group-head" ]
                    [ h3 [ class "pref-label", id "pref-saved-transfer-title" ] [ text "Saved searches" ]
                    , span [ class "pref-count" ] [ text (GapAccount.savedSearchLabel (List.length model.savedSearches)) ]
                    ]
                , p [ class "pref-desc" ] [ text "Move your saved searches between browsers as a JSON file. Importing merges with the ones already here." ]
                , div [ class "pref-actions" ]
                    [ button [ type_ "button", class "pref-reset", attribute "data-testid" "pref-saved-searches-export", onClick (gap SearchExport) ] [ text "Export saved searches" ]
                    , button [ type_ "button", class "pref-reset", attribute "data-testid" "pref-saved-searches-import", onClick (gap SearchImport) ] [ text "Import saved searches" ]
                    ]
                , searchStatusLine model
                ]
            ]
