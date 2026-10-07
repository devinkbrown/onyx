module View.Search exposing (panel)

{-| Message search panel, mirroring `src/shell/search/MessageSearch.tsx`
(live tier): query field with match count, close control, scope line,
result navigation, and the device-saved list with run/delete plus a
save-current row.

Fold ownership: open/query/index/save-name state and the bounded live
filter live in `App` (`searchResults`); this module renders the
oracle's chrome and hooks.

Documented narrowings: the history-off branch stays ahead — the
panel covers the live conversation plus saved searches plus live-tier
recall chips plus mode-switched device-memory hits ("Saved on this
device", open-via-travel; hybrid/exact/semantic toggle mirrors the
in-search mode cycle) plus archived server results ("Archived
history" with deep search over Ctrl+Enter, open-navigates without
server time-travel until the CHATHISTORY request half lands), and
opens against the active channel; label elements use `aria-label` (no
`sr-only` utility in `app.css`); the Room-ledger link stays with the
Stats slice; nav arrows are text glyphs (the oracle inlines SVG).
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, button, div, form, input, li, p, section, small, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, disabled, id, maxlength, placeholder, title, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Json.Decode as Decode
import SavedSearches
import Search


inputId : String
inputId =
    "onyx-message-search-input"


statusId : String
statusId =
    "onyx-message-search-status"


saveInputId : String
saveInputId =
    "onyx-message-search-save-label"


{-| Input keys: Enter steps forward, Shift+Enter steps back, Escape
closes (mirroring the panel handlers; IME-composed keys stay out —
Elm has no keyCode, so the `key` read is the whole guard). -}
searchKey : Decode.Decoder Msg
searchKey =
    Decode.map5
        (\key shift ctrl meta alt ->
            if key == "Escape" && not shift && not ctrl && not meta then
                Just SearchClose

            else if key == "Enter" && (ctrl || meta) && not shift && not alt then
                Just SearchRunServer

            else if key == "Enter" && not ctrl && not meta then
                if shift then
                    Just SearchPrevious

                else
                    Just SearchNext

            else
                Nothing
        )
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "shiftKey" Decode.bool, Decode.succeed False ])
        (Decode.oneOf [ Decode.field "ctrlKey" Decode.bool, Decode.succeed False ])
        (Decode.oneOf [ Decode.field "metaKey" Decode.bool, Decode.succeed False ])
        (Decode.oneOf [ Decode.field "altKey" Decode.bool, Decode.succeed False ])
        |> Decode.andThen
            (\maybe ->
                case maybe of
                    Just msg ->
                        Decode.succeed msg

                    Nothing ->
                        Decode.fail "unclaimed key"
            )


{-| The open panel (rendered by the shell above the thread). -}
panel : Model -> Html Msg
panel model =
    let
        results =
            App.searchResults model

        count =
            List.length results

        position =
            Search.activePosition count model.searchIndex

        target =
            App.searchTargetLabel model

        query =
            String.trim model.searchQuery
    in
    div [ class "onyx-message-search", attribute "role" "search", attribute "aria-label" "Message search", on "keydown" panelKey ]
        [ div [ class "onyx-message-search__surface" ]
            [ div [ class "onyx-message-search__query-field" ]
                [ input
                    [ id inputId
                    , class "onyx-message-search__input"
                    , type_ "search"
                    , value model.searchQuery
                    , maxlength Search.maxQueryLength
                    , attribute "autocomplete" "off"
                    , attribute "spellcheck" "false"
                    , attribute "aria-label" "Search messages"
                    , attribute "aria-describedby" statusId
                    , placeholder ("Find messages in " ++ target)
                    , onInput (\next -> SearchQuery { query = next })
                    , on "keydown" searchKey
                    ]
                    []
                , span [ class "onyx-message-search__count", attribute "aria-hidden" "true" ]
                    [ text (Search.countLabel count position) ]
                ]
            , button
                [ type_ "button"
                , class "onyx-message-search__button onyx-message-search__button--close"
                , attribute "aria-label" "Close search"
                , attribute "aria-keyshortcuts" "Escape"
                , title "Close search"
                , onClick SearchClose
                ]
                [ text "×" ]
            ]
        , div [ class "onyx-message-search__body" ]
            [ div [ class "onyx-message-search__target", attribute "data-testid" "message-search-target" ]
                [ span [ class "onyx-message-search__target-kicker" ] [ text "Searching in" ]
                , text " "
                , strong [] [ text target ]
                ]
            , div [ class "onyx-message-search__controls", attribute "role" "group", attribute "aria-label" "Search result navigation" ]
                [ button
                    [ type_ "button"
                    , class "onyx-message-search__button"
                    , attribute "aria-label" "Previous match"
                    , title "Previous match"
                    , disabled (count == 0)
                    , onClick SearchPrevious
                    ]
                    [ text "↑" ]
                , button
                    [ type_ "button"
                    , class "onyx-message-search__button"
                    , attribute "aria-label" "Next match"
                    , title "Next match"
                    , disabled (count == 0)
                    , onClick SearchNext
                    ]
                    [ text "↓" ]
                ]
            , savedSection model query
            , recallSection model
            , serverSection model query
            , serverBlockedNotice model query
            , vaultSection model
            , p [ class "onyx-message-search__status", attribute "role" "status", id statusId ]
                [ text (Search.statusLabel model.searchQuery target count position) ]
            , p [ class "onyx-message-search__status", attribute "role" "status", attribute "data-testid" "device-search-status" ]
                [ text (App.vaultStatusLabel model) ]
            , p [ class "onyx-message-search__status", attribute "role" "status", attribute "data-testid" "server-search-status" ]
                [ text (App.serverStatusLabel model) ]
            ]
        ]


{-| Device recall terms: lexical pivots from the live matches
(mirroring the `onyx-message-search__recall` group; a chip applies
its term as the query, mirroring `applyRecallSuggestion`). The
oracle's device-scope `ProvenanceBadge` has no Elm equivalent yet —
the group label carries the device-recall semantics. -}
recallSection : Model -> Html Msg
recallSection model =
    case App.searchRecallTerms model of
        [] ->
            text ""

        terms ->
            div
                [ class "onyx-message-search__recall"
                , attribute "role" "group"
                , attribute "aria-label" "Device recall terms"
                ]
                (List.map recallChip terms)


recallChip : String -> Html Msg
recallChip term =
    button
        [ type_ "button"
        , class "onyx-message-search__recall-chip"
        , onClick (SearchQuery { query = term })
        ]
        [ text term ]


{-| Remembered-elsewhere hits from device memory (mirroring the
`vault-search` section: shown only with hits; the resolved batch mode
labels the section and the toggle cycles hybrid → exact → semantic
like `VAULT_MODE_CYCLE`; a row opens its conversation at the hit's
stamp). The oracle's `ProvenanceBadge` has no Elm equivalent — the
section label carries the device-memory semantics. -}
vaultSection : Model -> Html Msg
vaultSection model =
    case App.vaultHits model of
        [] ->
            text ""

        hits ->
            div [ class "onyx-message-search__vault", attribute "data-testid" "vault-search" ]
                [ div [ class "onyx-message-search__vault-bar" ]
                    [ strong [ class "onyx-message-search__section-title" ] [ text "Remembered elsewhere" ]
                    , span [ class "onyx-message-search__vault-label" ] [ text "Saved on this device" ]
                    , span [ class "onyx-message-search__server-count" ]
                        [ text (String.fromInt (List.length hits) ++ " remembered · " ++ App.vaultSearchModeToString model.vaultSearchModeShown) ]
                    , button
                        [ type_ "button"
                        , class "onyx-message-search__vault-mode"
                        , title "Switch device-memory search mode (hybrid, exact, semantic)"
                        , onClick CycleVaultSearchMode
                        ]
                        [ text ("Mode: " ++ App.vaultSearchModeToString model.vaultSearchMode) ]
                    ]
                , ul [ class "onyx-message-search__server-list", attribute "role" "list", attribute "aria-label" "Device-memory message results" ]
                    (List.map vaultRow hits)
                ]


vaultRow : App.VaultHit -> Html Msg
vaultRow hit =
    li []
        [ button
            [ type_ "button"
            , class "onyx-message-search__server-row"
            , title ("Open " ++ hit.target ++ " at this message")
            , onClick (VaultOpenHit { target = hit.target, at = hit.at })
            ]
            [ span [ class "onyx-message-search__vault-target" ] [ text hit.target ]
            , if hit.at <= 0 then
                text ""

              else
                span [ class "onyx-message-search__server-when" ] [ text (App.formatClockUtc hit.at) ]
            , strong [] [ text hit.from ]
            , span [ class "onyx-message-search__server-text" ] [ text hit.text ]
            ]
        ]


{-| Archived server history section (mirroring the `server-search`
block: gated on a non-empty query without the E2EE block while the
deep search can run or has settled; the deep button runs over
Ctrl+Enter; counts, errors, and limit notices mirror the oracle
copy; rows open their conversation at the archived row). The
oracle's server `ProvenanceBadge` has no Elm equivalent — the
section title carries the archived-history semantics. -}
serverSection : Model -> String -> Html Msg
serverSection model query =
    if String.isEmpty (String.trim query) || App.serverSearchBlockedByE2ee model then
        text ""

    else if not (App.canRunServerSearch model) && App.serverStatusForPanel model == App.ServerSearchIdle then
        text ""

    else
        div [ class "onyx-message-search__server", attribute "data-testid" "server-search", attribute "aria-busy" (busyFlag (App.serverStatusForPanel model == App.ServerSearchPending)) ]
            [ div [ class "onyx-message-search__server-bar" ]
                [ strong [ class "onyx-message-search__section-title" ] [ text "Archived history" ]
                , button
                    [ type_ "button"
                    , class "onyx-message-search__deep"
                    , disabled (not (App.canRunServerSearch model) || App.serverStatusForPanel model == App.ServerSearchPending)
                    , onClick SearchRunServer
                    , title "Search the server's full history for this conversation (Ctrl+Enter)"
                    ]
                    [ text
                        (if App.serverStatusForPanel model == App.ServerSearchPending then
                            "Searching archived history…"

                         else
                            "Search full server history"
                        )
                    ]
                , serverCount model
                , serverError model
                , serverNotice model
                ]
            , serverResults model
            ]


busyFlag : Bool -> String
busyFlag busy =
    if busy then
        "true"

    else
        "false"


serverCount : Model -> Html Msg
serverCount model =
    if App.serverStatusForPanel model /= App.ServerSearchDone then
        text ""

    else
        span [ class "onyx-message-search__server-count" ]
            [ text
                (case List.length (App.serverResultsForPanel model) of
                    0 ->
                        "no archived matches"

                    1 ->
                        "1 archived match"

                    n ->
                        String.fromInt n ++ " archived matches"
                )
            ]


serverError : Model -> Html Msg
serverError model =
    if App.serverStatusForPanel model /= App.ServerSearchError then
        text ""

    else
        span [ class "onyx-message-search__server-error" ]
            [ text (Maybe.withDefault "Search failed." model.serverSearchError) ]


serverNotice : Model -> Html Msg
serverNotice model =
    if App.serverStatusForPanel model /= App.ServerSearchDone then
        text ""

    else
        case model.serverSearchNotice of
            Nothing ->
                text ""

            Just notice ->
                span [ class "onyx-message-search__server-notice" ] [ text notice ]


serverResults : Model -> Html Msg
serverResults model =
    case App.serverResultsForPanel model of
        [] ->
            text ""

        hits ->
            ul [ class "onyx-message-search__server-list", attribute "role" "list", attribute "aria-label" "Archived message results" ]
                (List.map serverRow hits)


serverRow : App.VaultHit -> Html Msg
serverRow hit =
    li []
        [ button
            [ type_ "button"
            , class "onyx-message-search__server-row"
            , title "Open archived context and jump to this message"
            , onClick (ServerOpenResult { target = hit.target })
            ]
            [ if hit.at <= 0 then
                text ""

              else
                span [ class "onyx-message-search__server-when" ] [ text (App.formatClockUtc hit.at) ]
            , strong [] [ text hit.from ]
            , span [ class "onyx-message-search__server-text" ] [ text hit.text ]
            ]
        ]


{-| Encrypted-DM notice: server search stays on this device
(mirroring the `history-off` block). -}
serverBlockedNotice : Model -> String -> Html Msg
serverBlockedNotice model query =
    if String.isEmpty (String.trim query) || not (App.serverSearchBlockedByE2ee model) then
        text ""

    else
        div [ class "onyx-message-search__history-off", attribute "role" "status" ]
            [ text "Encrypted DM search stays on this device. Loaded decrypted lines are searched here; query text and ciphertext history are not sent to server search." ]


{-| Panel-level Escape (the input handler covers keys typed inside
the field; this covers the buttons and saved rows). -}
panelKey : Decode.Decoder Msg
panelKey =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                if key == "Escape" then
                    Decode.succeed SearchClose

                else
                    Decode.fail "unclaimed key"
            )


{-| Saved searches: save-current row plus run/delete rows
(mirroring the `onyx-message-search__saved` section; the row shows
while saves exist or the query is runnable). -}
savedSection : Model -> String -> Html Msg
savedSection model query =
    if List.isEmpty model.savedSearches && String.length query < 2 then
        text ""

    else
        section [ class "onyx-message-search__saved", attribute "aria-label" "Saved searches" ]
            [ div [ class "onyx-message-search__saved-bar" ]
                [ strong [ class "onyx-message-search__section-title" ] [ text "Saved searches" ]
                , span [ class "onyx-message-search__vault-label" ] [ text "Saved on this device" ]
                , span [ class "onyx-message-search__server-count" ]
                    [ text (String.fromInt (List.length model.savedSearches) ++ " saved") ]
                ]
            , if String.length query >= 2 then
                form [ class "onyx-message-search__save-form", onSubmit SearchSaveCurrent ]
                    [ input
                        [ id saveInputId
                        , class "onyx-message-search__save-input"
                        , value model.searchSaveName
                        , maxlength Search.maxSaveLabelLength
                        , placeholder "Name this device search"
                        , attribute "aria-label" "Saved search name"
                        , onInput (\name -> SearchSaveName { name = name })
                        ]
                        []
                    , button
                        [ type_ "submit"
                        , class "onyx-message-search__deep"
                        , disabled (String.isEmpty (String.trim model.searchSaveName))
                        ]
                        [ text "Save search" ]
                    ]

              else
                text ""
            , if List.isEmpty model.savedSearches then
                text ""

              else
                ul [ class "onyx-message-search__saved-list", attribute "aria-label" "Saved search list" ]
                    (List.map savedRow model.savedSearches)
            ]


savedRow : SavedSearches.SavedSearch -> Html Msg
savedRow saved =
    li [ class "onyx-message-search__saved-row" ]
        [ button
            [ type_ "button"
            , class "onyx-message-search__saved-run"
            , onClick (SearchRunSaved { id = saved.id })
            , attribute "aria-label" ("Run saved search " ++ saved.label)
            ]
            [ strong [] [ text saved.label ]
            , span [] [ text saved.query ]
            , small [] [ text (Search.modeLabel (SavedSearches.modeToString saved.mode)) ]
            ]
        , button
            [ type_ "button"
            , class "onyx-message-search__saved-delete"
            , onClick (SearchDeleteSaved { id = saved.id })
            , attribute "aria-label" ("Delete saved search " ++ saved.label)
            ]
            [ text "Delete" ]
        ]
