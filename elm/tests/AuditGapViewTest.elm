module AuditGapViewTest exposing (suite)

{-| View-level vectors from the 2026-11-05 acceptance audits: the
delivery-unknown journal row offers no dead retry, an inline reply to a
missing parent says so, the E44 handover-recovery copy renders, and an
E24 failed account-security observation renders as failure only.
-}

import App exposing (..)
import Dict
import Expect
import Ids
import RuntimeDomain
import Set
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.RuntimeServices
import View.Stewardship
import View.Thread


owner : RuntimeOwnerStamp
owner =
    { ownerRef = "test_owner_000000000000000000000000", networkId = "test_network", accountId = Just "alice", accountGeneration = 1, connectionGeneration = 1 }


journalResult : String -> Maybe RuntimeDomain.ResultView
journalResult state =
    case ( ( Ids.requestIdFromRuntime "domainRequest000000000001", Ids.ownerRefFromRuntime owner.ownerRef ), ( Ids.accountGenerationFromInt 1, Ids.connectionGenerationFromInt 1 ) ) of
        ( ( Just requestId, Just ownerRef ), ( Just accountGeneration, Just connectionGeneration ) ) ->
            Just
                { requestId = requestId
                , ownerRef = ownerRef
                , accountGeneration = accountGeneration
                , connectionGeneration = connectionGeneration
                , domain = "journal"
                , action = "list"
                , status = RuntimeDomain.Accepted
                , completionScope = "local"
                , reason = Nothing
                , items = [ { ref = "journal_entry_ref_000001", label = "Message to #c", state = state, extra = [] } ]
                , draftTarget = Nothing
                , draftText = Nothing
                , draftRevision = Nothing
                , selectedContinuationRef = Nothing
                , anchorTarget = Nothing
                , anchorAcceptedTimestamp = Nothing
                , anchorViewedCandidate = Nothing
                , scheduledMode = Nothing
                , scheduledLegacyHeldCount = 0
                , scheduledLegacyReviewUnavailable = False
                , scheduledViewReady = False
                , scheduledItems = []
                , sessionRecovery = Nothing
                , passkeyManagement = Nothing
                , sessionInventory = Nothing
                , sessionRevocation = Nothing
                , accountCommunity = Nothing
                , serviceIntegration = Nothing
                , draftRecovery = Nothing
                , mediaQuality = Nothing
                , mediaControl = Nothing
                }

        _ ->
            Nothing


services : Maybe RuntimeDomain.ResultView -> Maybe { action : String, phase : String, outcome : String, reason : Maybe String, targetAccount : Maybe String, requiresLogin : Bool } -> Query.Single Msg
services result status =
    View.RuntimeServices.view result Nothing Nothing status False Nothing "" 0 Nothing Nothing "" False False False False
        |> Query.fromHtml


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


harbor : Dict.Dict String Channel
harbor =
    let
        member nick modes =
            ( String.toLower nick, { nick = nick, modes = Set.fromList modes, away = False } )
    in
    Dict.singleton "#harbor"
        { name = "#harbor"
        , topic = ""
        , members =
            Dict.fromList
                [ member "alice" []
                , member "bob" [ 'Q', 'q' ]
                , member "cara" []
                , member "drew" []
                ]
        , modes = ""
        , messages = []
        , lastSeen = Nothing
        , unread = 0
        , highlights = 0
        , createdAt = Nothing
        }


handover : String -> RuntimeOwnerStamp -> Model
handover status attemptOwner =
    { blank
        | ourNick = "alice"
        , connection = Live
        , channels = harbor
        , stewardRoom = Just "#harbor"
        , runtimeOwnerStamp = Just owner
        , stewardTransferAttempts =
            Dict.singleton "#harbor"
                { owner = attemptOwner
                , channel = "#harbor"
                , from = "alice"
                , to = "bob"
                , expected = []
                , accepted = []
                , status = status
                , deadline = 0
                , reconcileAt = Nothing
                , reconcileSawNames = False
                }
    }


suite : Test
suite =
    describe "Audit 2026-11-05 view gaps"
        [ test "a delivery-unknown journal row offers only the outcome check, never a dead retry" <|
            \_ ->
                let
                    unknown =
                        services (journalResult "delivery-unknown") Nothing

                    queued =
                        services (journalResult "queued") Nothing
                in
                Expect.all
                    [ \_ -> unknown |> Query.has [ Selector.text "Check delivery outcome" ]
                    , \_ -> unknown |> Query.hasNot [ Selector.text "Confirm retry; this may duplicate the message" ]
                    , \_ -> unknown |> Query.findAll [ Selector.tag "button", Selector.containing [ Selector.text "retry" ] ] |> Query.count (Expect.equal 0)
                    , \_ -> queued |> Query.has [ Selector.text "Cancel queued message" ]
                    ]
                    ()
        , test "an inline reply to a missing parent renders an explicit unavailable context" <|
            \_ ->
                let
                    joined =
                        feed { blank | ourNick = "me" } ":me!u@h JOIN #c"

                    selected =
                        Tuple.first (update (ChannelSelect "#c") joined)

                    withParent =
                        feed selected "@msgid=p1 :bob!u@h PRIVMSG #c :the parent"

                    orphan =
                        feed withParent "@msgid=c1;+draft/reply=gone :bob!u@h PRIVMSG #c :child of nothing"

                    child =
                        feed withParent "@msgid=c2;+draft/reply=p1 :cara!u@h PRIVMSG #c :child of p1"

                    render m =
                        View.Thread.thread m |> Query.fromHtml
                in
                Expect.all
                    [ \_ -> render orphan |> Query.find [ Selector.class "shell-msg-reply" ] |> Query.has [ Selector.text "Original message unavailable" ]
                    , \_ -> render child |> Query.find [ Selector.class "shell-msg-reply" ] |> Query.hasNot [ Selector.text "Original message unavailable" ]
                    , \_ -> render child |> Query.find [ Selector.class "shell-msg-reply" ] |> Query.has [ Selector.text "the parent" ]
                    ]
                    ()
        , test "the E44 handover recovery copy renders for an unknown outcome under the current owner" <|
            \_ ->
                let
                    render m =
                        View.Stewardship.stewardPanel m |> Query.fromHtml

                    otherOwner =
                        { owner | ownerRef = "test_owner_000000000000000000000099" }
                in
                Expect.all
                    [ \_ ->
                        render (handover "unknown" owner)
                            |> Query.has [ Selector.text "The ownership command outcome is unknown. You no longer have owner privileges, so this view can only refresh the roster." ]
                    , \_ ->
                        render (handover "observed" owner)
                            |> Query.has [ Selector.text "The visible roster has been reviewed, but the earlier command outcome is still unknown. You no longer have owner privileges, so only roster refresh is available." ]
                    , \_ -> render (handover "unknown" owner) |> Query.has [ Selector.text "Refresh roster" ]
                    , \_ -> render (handover "unknown" otherOwner) |> Query.hasNot [ Selector.text "Ownership handover status" ]
                    , \_ -> render (handover "accepted" owner) |> Query.hasNot [ Selector.text "Ownership handover status" ]
                    ]
                    ()
        , test "a failed account-security observation renders as failure without success copy" <|
            \_ ->
                let
                    failed =
                        services Nothing (Just { action = "reset-password", phase = "failed", outcome = "password-reset", reason = Just "INVALID_CODE", targetAccount = Nothing, requiresLogin = False })

                    accepted =
                        services Nothing (Just { action = "reset-password", phase = "accepted", outcome = "password-reset", reason = Nothing, targetAccount = Nothing, requiresLogin = False })
                in
                Expect.all
                    [ \_ -> failed |> Query.has [ Selector.text "The operation failed." ]
                    , \_ -> failed |> Query.hasNot [ Selector.text "The password reset completed. Sign in explicitly with the new password." ]
                    , \_ -> failed |> Query.hasNot [ Selector.text "INVALID_CODE" ]
                    , \_ -> accepted |> Query.has [ Selector.text "The password reset completed. Sign in explicitly with the new password." ]
                    ]
                    ()
        ]
