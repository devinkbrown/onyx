module View.HistoryImport exposing (transfer)

{-| v3/gap-import — the Preferences → Import & export pane (parity rows
V45–V57).

Top to bottom, only what applies right now:

  - **Activity**: file-picker wait / progress with Cancel, or the last
    result with Undo.
  - **Review** (replaces everything else while it is open): what the
    files hold, per-conversation include + destination, the exact
    count that will be written, Cancel / Import. Nothing is written
    until Import.
  - **Bring history from another app**: Discord export, Discord data
    package, Slack export, IRC logs.
  - **Portable vault**: export, and import of an Onyx vault file (which
    goes through the same review).
  - **Imported history**: past imports, each removable.

All state and rules live in `HistoryImport`; this module only draws it.

-}

import App exposing (Model, Msg(..))
import Dict
import HistoryImport as HI exposing (Phase(..), Source)
import Html exposing (Html, button, div, h3, h4, input, label, li, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, checked, class, classList, disabled, for, id, placeholder, spellcheck, tabindex, type_, value)
import Html.Events exposing (onCheck, onClick, onInput, preventDefaultOn)
import Json.Decode as Decode
import PrefsPanel
import Retention


transfer : Model -> List (Html Msg)
transfer model =
    case model.historyImport.phase of
        Reviewing staged ->
            -- Mid-review the pane is just the review: nothing below it, so
            -- its sticky Cancel / Import bar is the last thing on the page.
            [ reviewCard model staged ]

        _ ->
            [ activity model
            , importCard model
            , vaultCard model
            , batchesCard model
            ]


msg : HI.Msg -> Msg
msg =
    HistoryImportMsg



-- ACTIVITY


{-| A single live strip: waiting for the picker, reading, removing, or
the last outcome.
-}
activity : Model -> Html Msg
activity model =
    let
        hi =
            model.historyImport
    in
    case hi.phase of
        Picking _ ->
            div [ class "hi-activity", attribute "data-testid" "history-import-activity", attribute "role" "status" ]
                [ div [ class "hi-activity-row" ]
                    [ span [ class "hi-activity-text" ] [ text "Waiting for your files…" ]
                    , button [ type_ "button", class "hi-btn", onClick (msg HI.Cancel) ] [ text "Cancel" ]
                    ]
                , p [ class "pref-desc hi-activity-sub" ] [ text "Choose them in the window that opened. Nothing is read until you do." ]
                ]

        Working w ->
            let
                pct =
                    HI.progressPercent w
            in
            div [ class "hi-activity", attribute "data-testid" "history-import-activity" ]
                [ div [ class "hi-activity-row" ]
                    [ span [ class "hi-activity-text", attribute "role" "status" ] [ text (stepLabel w.step w.files pct) ]
                    , button [ type_ "button", class "hi-btn", onClick (msg HI.Cancel) ] [ text "Cancel" ]
                    ]
                , div
                    [ class "hi-bar"
                    , attribute "role" "progressbar"
                    , attribute "aria-label" "Import progress"
                    , attribute "aria-valuemin" "0"
                    , attribute "aria-valuemax" "100"
                    , attribute "aria-valuenow" (String.fromInt pct)
                    ]
                    [ span [ class "hi-bar-fill", Html.Attributes.style "width" (String.fromInt pct ++ "%") ] [] ]
                , p [ class "pref-desc hi-activity-sub" ] [ text "Big exports are read in the background, so the app stays usable. Cancel stops it and writes nothing." ]
                ]

        _ ->
            case hi.removing of
                Just _ ->
                    div [ class "hi-activity", attribute "role" "status" ]
                        [ div [ class "hi-activity-row" ] [ span [ class "hi-activity-text" ] [ text "Removing imported messages…" ] ] ]

                Nothing ->
                    case hi.status of
                        Just status ->
                            div
                                [ class "hi-note"
                                , attribute "data-tone"
                                    (if status.failure then
                                        "bad"

                                     else
                                        "ok"
                                    )
                                , id HI.statusId
                                , tabindex -1
                                , attribute "data-testid" "history-import-status"
                                , attribute "role"
                                    (if status.failure then
                                        "alert"

                                     else
                                        "status"
                                    )
                                ]
                                [ span [ class "hi-note-text" ] [ text status.message ]
                                , span [ class "hi-note-actions" ]
                                    ((case hi.lastBatch of
                                        Just _ ->
                                            if status.failure then
                                                []

                                            else
                                                [ button [ type_ "button", class "hi-btn hi-btn--quiet", attribute "data-testid" "history-import-undo", onClick (msg HI.Undo) ] [ text "Undo import" ] ]

                                        Nothing ->
                                            []
                                     )
                                        ++ [ button [ type_ "button", class "hi-btn hi-btn--quiet", attribute "aria-label" "Dismiss message", onClick (msg HI.DismissStatus) ] [ text "Dismiss" ] ]
                                    )
                                ]

                        Nothing ->
                            text ""


stepLabel : String -> Int -> Int -> String
stepLabel step files pct =
    let
        what =
            case step of
                "parsing" ->
                    "Reading " ++ HI.countLabel (max 1 files) "file"

                "finishing" ->
                    "Putting messages in order"

                "checking" ->
                    "Checking against this device"

                _ ->
                    "Opening " ++ HI.countLabel (max 1 files) "file"
    in
    what ++ "… " ++ String.fromInt pct ++ "%"



-- SOURCES


importCard : Model -> Html Msg
importCard model =
    let
        hi =
            model.historyImport

        info =
            HI.sourceInfo hi.source

        busy =
            HI.busy hi
    in
    section
        [ class "pref-group hi-card"
        , attribute "aria-labelledby" "hi-import-title"
        , attribute "data-testid" "history-import"
        ]
        [ div [ class "pref-group-head" ]
            [ h3 [ class "pref-label", id "hi-import-title" ] [ text "Bring history from another app" ]
            , span [ class "pref-count" ] [ text "Stays on this device" ]
            ]
        , p [ class "pref-desc" ]
            [ text "Read an export, check what it holds, then add it to this browser's history. Files are read here and never uploaded." ]
        , div
            [ class "hi-sources"
            , attribute "role" "radiogroup"
            , attribute "aria-label" "Where the history comes from"
            , attribute "aria-describedby" "hi-source-blurb"
            ]
            (List.map (sourceButton hi.source) HI.sources)
        , p [ class "pref-desc hi-blurb", id "hi-source-blurb" ] [ text info.blurb ]
        , div [ class "pref-actions" ]
            [ button
                [ type_ "button"
                , class "hi-btn hi-btn--primary"
                , id "history-import-choose"
                , attribute "data-testid" "history-import-choose"
                , disabled busy
                , onClick (msg (HI.Choose hi.source))
                ]
                [ text info.choose ]
            ]
        ]


sourceButton : Source -> Source -> Html Msg
sourceButton current source =
    let
        active =
            source == current

        keys =
            List.map HI.sourceKey HI.sources

        radioId s =
            "history-import-source-" ++ HI.sourceKey s
    in
    button
        [ type_ "button"
        , class "hi-seg"
        , id (radioId source)
        , attribute "role" "radio"
        , attribute "aria-checked" (boolString active)
        , tabindex
            (if active then
                0

             else
                -1
            )
        , onClick (msg (HI.SelectSource source))
        , preventDefaultOn "keydown"
            (Decode.field "key" Decode.string
                |> Decode.andThen
                    (\key ->
                        case PrefsPanel.segmentAfterKey keys (HI.sourceKey source) key |> Maybe.andThen HI.sourceFromKey of
                            Just next ->
                                Decode.succeed ( PrefsSegmentKey { focusId = radioId next } (msg (HI.SelectSource next)), True )

                            Nothing ->
                                Decode.fail "unhandled"
                    )
            )
        ]
        [ text (HI.sourceInfo source).short ]



-- REVIEW


type alias Selection =
    { fresh : Int
    , already : Int
    , trimmed : Int
    , conversations : Int
    , invalid : Int
    , dms : Int
    , keep : Int
    }


{-| What Import would do right now, from the same plan the confirm uses
(so the numbers on screen are the numbers written).
-}
selection : Model -> HI.State -> HI.Staged -> Selection
selection model hi staged =
    let
        limits =
            { nowMs = model.nowMs
            , keepFor = Retention.effectiveKeep model.retentionPolicy
            , maxAgeDays = model.retentionPolicy.maxAgeDays
            }

        p =
            HI.plan limits hi staged

        included =
            List.filter (\conv -> (HI.destFor hi conv).include) staged.conversations

        dms =
            List.length
                (List.filter
                    (\conv ->
                        case HI.normalizeDestination (HI.destFor hi conv).value of
                            Ok { dm } ->
                                dm

                            Err _ ->
                                False
                    )
                    included
                )
    in
    { fresh = p.written
    , already = p.already
    , trimmed = p.trimmed
    , conversations = List.length included
    , invalid = List.length p.errors
    , dms = dms
    , keep = model.retentionPolicy.keep
    }


shownLimit : Int
shownLimit =
    6


reviewCard : Model -> HI.Staged -> Html Msg
reviewCard model staged =
    let
        hi =
            model.historyImport

        sel =
            selection model hi staged

        total =
            List.length staged.conversations

        shown =
            if hi.showAll then
                staged.conversations

            else
                List.take shownLimit staged.conversations

        info =
            HI.sourceInfo staged.source

        open =
            Dict.keys model.channels

        leftOut =
            leftOutNotes staged

        allOn =
            sel.conversations == total

        failed =
            case hi.status of
                Just s ->
                    if s.failure then
                        Just s.message

                    else
                        Nothing

                Nothing ->
                    Nothing

        importLabel =
            if sel.invalid > 0 then
                "Fix destinations"

            else if sel.fresh == 0 then
                "Nothing new to import"

            else
                "Import " ++ HI.countLabel sel.fresh "message"
    in
    section
        [ class "pref-group hi-card hi-review"
        , attribute "aria-labelledby" HI.reviewTitleId
        , attribute "data-testid" "history-import-review"
        ]
        [ div [ class "hi-review-head" ]
            [ p [ class "hi-kicker" ] [ text info.title ]
            , h4 [ class "hi-review-title", id HI.reviewTitleId, tabindex -1 ] [ text "Review before importing" ]
            , p [ class "pref-desc hi-review-sub" ]
                [ text
                    ((if String.isEmpty staged.label then
                        ""

                      else
                        staged.label ++ " · "
                     )
                        ++ HI.countLabel staged.files "file"
                        ++ ". Nothing is written until you choose Import."
                    )
                ]
            ]
        , div [ class "hi-tally", attribute "role" "group", attribute "aria-label" "What the import holds" ]
            [ tally "New" (HI.groupThousands sel.fresh) "will be added"
            , tally "Already here" (HI.groupThousands sel.already) "skipped"
            , tally "Included" (String.fromInt sel.conversations ++ " of " ++ String.fromInt total) "conversations"
            ]
        , if List.isEmpty leftOut then
            text ""

          else
            Html.details [ class "hi-left-out" ]
                [ Html.summary [] [ text "What was left out" ]
                , ul [ class "hi-left-list" ] (List.map (\n -> li [] [ text n ]) leftOut)
                ]
        , div [ class "hi-review-bar" ]
            [ span [ class "hi-review-bar-title" ] [ text "Where it goes" ]
            , button
                [ type_ "button"
                , class "hi-btn hi-btn--quiet"
                , onClick (msg (HI.IncludeAll (not allOn)))
                ]
                [ text
                    (if allOn then
                        "Select none"

                     else
                        "Select all"
                    )
                ]
            ]
        , ul [ class "hi-convs", attribute "aria-label" "Conversations to import" ]
            (List.map (convRow model open) shown)
        , if total > List.length shown then
            button
                [ type_ "button"
                , class "hi-btn hi-btn--quiet hi-more"
                , onClick (msg HI.ShowAll)
                ]
                [ text ("Show all " ++ HI.groupThousands total ++ " conversations") ]

          else
            text ""
        , if sel.trimmed > 0 then
            p [ class "pref-desc hi-privacy", attribute "data-testid" "history-import-trimmed" ]
                [ text
                    (HI.countLabel sel.trimmed "older message"
                        ++ " fall outside the history this device keeps ("
                        ++ HI.groupThousands sel.keep
                        ++ " per conversation, set in History & data) and will be left out. Imported messages count toward that limit with what a conversation already holds, oldest first."
                    )
                ]

          else
            text ""
        , if sel.dms > 0 then
            p [ class "pref-desc hi-privacy" ] [ text "Imported direct messages are kept as readable text in this browser's local history." ]

          else
            text ""
        , case failed of
            Just message ->
                p [ class "hi-error", attribute "role" "alert" ] [ text message ]

            Nothing ->
                text ""
        , div [ class "hi-review-foot" ]
            [ button
                [ type_ "button"
                , class "hi-btn"
                , attribute "data-testid" "history-import-cancel"
                , onClick (msg HI.Cancel)
                ]
                [ text "Cancel" ]
            , button
                [ type_ "button"
                , class "hi-btn hi-btn--primary"
                , attribute "data-testid" "history-import-confirm"
                , disabled (sel.fresh == 0 && sel.invalid == 0)
                , onClick (msg HI.Confirm)
                ]
                [ text importLabel ]
            ]
        ]


tally : String -> String -> String -> Html Msg
tally label_ value_ note_ =
    div [ class "hi-tally-cell" ]
        [ span [ class "hi-tally-label" ] [ text label_ ]
        , strong [ class "hi-tally-value" ] [ text value_ ]
        , span [ class "hi-tally-note" ] [ text note_ ]
        ]


{-| Everything the parser or the strict decoder dropped, in words.
-}
leftOutNotes : HI.Staged -> List String
leftOutNotes staged =
    List.filterMap identity
        [ note staged.systemSkipped "system line" "(joins, pins, call events) were not messages and were left out."
        , note staged.skipped "message" "could not be read or were not plain text (including encrypted envelopes from other apps)."
        , note staged.invalid "row" "failed the safety checks and were dropped."
        , note staged.duplicatesInFile "repeated message" "across the files were merged into one."
        , note staged.droppedOverCap "older message" ("were left out: each conversation keeps its newest " ++ HI.groupThousands HI.maxRowsPerConversation ++ ".")
        , note staged.overBudget "message" "were left out to stay within the import size limit."
        , note staged.rejectedFiles "file" "did not look like this kind of export and were ignored."
        , if staged.datesEstimated then
            Just "Some lines carried no date, so the file's own date was used. Their order is right; their day may be off."

          else
            Nothing
        ]


note : Int -> String -> String -> Maybe String
note n noun rest =
    if n <= 0 then
        Nothing

    else
        Just (HI.countLabel n noun ++ " " ++ rest)


convRow : Model -> List String -> HI.Conversation -> Html Msg
convRow model open conv =
    let
        hi =
            model.historyImport

        dest =
            HI.destFor hi conv

        inputId =
            "history-import-dest-" ++ conv.key

        metaId =
            "history-import-meta-" ++ conv.key

        errId =
            "history-import-err-" ++ conv.key

        problem =
            if dest.include then
                HI.destinationError dest.value

            else
                Nothing

        merges =
            dest.include && problem == Nothing && HI.isDestinationRoom open dest.value
    in
    li
        [ class "hi-conv"
        , classList [ ( "hi-conv--off", not dest.include ) ]
        , attribute "data-testid" "history-import-conversation"
        ]
        [ label [ class "hi-conv-main" ]
            [ input
                [ type_ "checkbox"
                , class "hi-check"
                , checked dest.include
                , onCheck (\_ -> msg (HI.Toggle conv.key))
                , attribute "aria-describedby" metaId
                ]
                []
            , span [ class "hi-conv-text" ]
                [ span [ class "hi-conv-name" ] [ text conv.source ]
                , span [ class "hi-conv-meta", id metaId ] [ text (convMeta model conv) ]
                ]
            ]
        , div [ class "hi-dest" ]
            [ label [ class "hi-dest-label", for inputId ]
                [ text
                    (if conv.dm then
                        "Add to person"

                     else
                        "Add to room"
                    )
                ]
            , input
                ([ type_ "text"
                 , id inputId
                 , class "hi-dest-input"
                 , value dest.value
                 , placeholder "#room or a nick"
                 , disabled (not dest.include)
                 , spellcheck False
                 , attribute "autocomplete" "off"
                 , attribute "autocapitalize" "off"
                 , attribute "autocorrect" "off"
                 , attribute "maxlength" "64"
                 , onInput (\v -> msg (HI.SetDest conv.key v))
                 ]
                    ++ (case problem of
                            Just _ ->
                                [ attribute "aria-invalid" "true", attribute "aria-describedby" errId ]

                            Nothing ->
                                []
                       )
                )
                []
            ]
        , case problem of
            Just message ->
                p [ class "hi-error", id errId ] [ text message ]

            Nothing ->
                if merges then
                    p [ class "hi-hint" ] [ text ("Joins the history of " ++ String.trim dest.value ++ ", which is open here.") ]

                else
                    text ""
        ]


convMeta : Model -> HI.Conversation -> String
convMeta model conv =
    let
        fresh =
            conv.count - conv.dupCount

        counts =
            if conv.dupCount > 0 then
                HI.countLabel fresh "new message" ++ ", " ++ String.fromInt conv.dupCount ++ " already here"

            else
                HI.countLabel conv.count "message"

        range =
            if conv.oldest <= 0 then
                Nothing

            else if HI.formatDay model.zone conv.oldest == HI.formatDay model.zone conv.newest then
                Just (HI.formatDay model.zone conv.oldest)

            else
                Just (HI.formatDay model.zone conv.oldest ++ " – " ++ HI.formatDay model.zone conv.newest)
    in
    String.join " · "
        (List.filterMap identity
            [ Just counts
            , range
            , if conv.dm then
                Just "Direct messages"

              else
                Nothing
            ]
        )



-- PORTABLE VAULT


vaultCard : Model -> Html Msg
vaultCard model =
    section [ class "pref-group pref-vault-portable hi-card", attribute "aria-labelledby" "pref-vault-portable-title" ]
        [ div [ class "pref-group-head" ]
            [ h3 [ class "pref-label", id "pref-vault-portable-title" ] [ text "Portable vault" ] ]
        , p [ class "pref-desc" ]
            [ text "Export this device's local message history as portable JSON, or bring a vault file back in (you review it first). Passwords, session tokens, and decrypted DM plaintext are not exported." ]
        , div [ class "pref-actions" ]
            [ button [ type_ "button", class "hi-btn", onClick PrefsVaultExport ] [ text "Export vault" ]
            , button
                [ type_ "button"
                , class "hi-btn"
                , attribute "data-testid" "history-import-vault"
                , disabled (HI.busy model.historyImport)
                , onClick PrefsVaultImport
                ]
                [ text "Import portable JSON" ]
            ]
        , case model.prefsTransferStatus of
            Just status ->
                p [ class "pref-status", attribute "role" "status" ] [ text status ]

            Nothing ->
                text ""
        ]



-- PAST IMPORTS


batchesCard : Model -> Html Msg
batchesCard model =
    let
        hi =
            model.historyImport
    in
    if List.isEmpty hi.batches then
        text ""

    else
        section
            [ class "pref-group hi-card"
            , attribute "aria-labelledby" "hi-batches-title"
            , attribute "data-testid" "history-import-batches"
            ]
            [ div [ class "pref-group-head" ]
                [ h3 [ class "pref-label", id "hi-batches-title" ] [ text "Imported history" ]
                , span [ class "pref-count" ] [ text (HI.countLabel (List.length hi.batches) "import") ]
                ]
            , p [ class "pref-desc" ]
                [ text "Removing an import deletes only the messages it added. Your live history, your original files and server history are untouched." ]
            , ul [ class "hi-batches" ] (List.map (batchRow model) hi.batches)
            ]


batchRow : Model -> HI.Batch -> Html Msg
batchRow model batch =
    let
        hi =
            model.historyImport

        asking =
            hi.removeAsk == Just batch.id

        working =
            hi.removing /= Nothing

        where_ =
            case batch.targets of
                [] ->
                    ""

                [ one ] ->
                    " · " ++ one

                first :: rest ->
                    " · " ++ first ++ " and " ++ String.fromInt (List.length rest) ++ " more"
    in
    li [ class "hi-batch", attribute "data-testid" "history-import-batch" ]
        [ div [ class "hi-batch-row" ]
            [ span [ class "hi-batch-copy" ]
                [ strong [ class "hi-batch-name" ] [ text (batchName batch) ]
                , span [ class "hi-batch-meta" ]
                    [ text
                        ((if batch.at > 0 then
                            HI.formatDay model.zone batch.at ++ " · "

                          else
                            ""
                         )
                            ++ HI.countLabel batch.messages "message"
                            ++ where_
                        )
                    ]
                ]
            , if asking then
                text ""

              else
                button
                    [ type_ "button"
                    , class "hi-btn hi-btn--quiet hi-btn--danger"
                    , id (HI.removeButtonId batch.id)
                    , attribute "aria-label" ("Remove import: " ++ batchName batch)
                    , disabled (working || HI.busy hi)
                    , onClick (msg (HI.RemoveAsk batch.id))
                    ]
                    [ text "Remove" ]
            ]
        , if asking then
            div [ class "hi-confirm", attribute "role" "group", attribute "aria-label" "Confirm removing this import" ]
                [ p [ class "pref-desc" ]
                    [ text ("Remove " ++ HI.countLabel batch.messages "imported message" ++ " from this device? You can import the files again later.") ]
                , div [ class "pref-actions" ]
                    [ button
                        [ type_ "button"
                        , class "hi-btn hi-btn--danger"
                        , id (HI.removeConfirmId batch.id)
                        , onClick (msg (HI.RemoveConfirm batch.id))
                        ]
                        [ text "Remove import" ]
                    , button [ type_ "button", class "hi-btn", onClick (msg HI.RemoveCancel) ] [ text "Keep it" ]
                    ]
                ]

          else
            text ""
        ]


batchName : HI.Batch -> String
batchName batch =
    if String.isEmpty batch.label then
        "Imported history"

    else
        batch.label


boolString : Bool -> String
boolString b =
    if b then
        "true"

    else
        "false"
