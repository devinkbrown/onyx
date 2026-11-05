module IntegrationsViewTest exposing (suite)

import App
import Expect
import Html.Attributes as Attr
import RuntimeDomain
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.Integrations


suite : Test
suite =
    describe "service integration controls"
        [ test "unknown registry keeps mutations disabled while refresh stays available" <|
            \_ ->
                let
                    query =
                        View.Integrations.serviceIntegrationPanel Nothing App.emptyServiceIntegrationForm
                            |> Query.fromHtml
                in
                Expect.all
                    [ \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Refresh bot grants" ] ] query |> Query.hasNot [ Selector.disabled True ]
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Refresh bot grants" ] ] query |> Event.simulate Event.click |> Event.expect (App.RuntimeDomainActionRequested (RuntimeDomain.ServiceRefresh "botgrant"))
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Grant speak" ] ] query |> Query.has [ Selector.disabled True ]
                    ]
                    ()
        , test "outbound hook rows expose only sanitized text and opaque controls" <|
            \_ ->
                let
                    safeView : RuntimeDomain.ServiceIntegrationView
                    safeView =
                        { requestId = "integration_request_0001"
                        , feature = "outhook"
                        , operation = Just "outhook-list"
                        , phase = "accepted"
                        , registry = "enabled"
                        , effectiveFeature = "enabled"
                        , accountProof = "unknown"
                        , authorization = "allowed"
                        , reason = Nothing
                        , rows = [ { kind = "entry", label = "Outbound hook", value = Just "Stored webhook", ref = Just "opaque_url_reference_00000001" } ]
                        , inputRef = Nothing
                        }

                    query =
                        View.Integrations.serviceIntegrationPanel (Just safeView) App.emptyServiceIntegrationForm
                            |> Query.fromHtml
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.text "Stored webhook" ] query
                    , \_ -> Query.hasNot [ Selector.text "https://private.example/path?secret=value" ] query
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Inspect private URL" ] ] query |> Query.hasNot [ Selector.disabled True ]
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Remove hook" ] ] query |> Query.hasNot [ Selector.disabled True ]
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Inspect private URL" ] ] query |> Event.simulate Event.click |> Event.expect (App.RuntimeDomainActionRequested (RuntimeDomain.ServiceOutHookInspect "opaque_url_reference_00000001"))
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Remove hook" ] ] query |> Event.simulate Event.click |> Event.expect (App.RuntimeDomainActionRequested (RuntimeDomain.ServiceOutHookRemove "opaque_url_reference_00000001"))
                    ]
                    ()
        , test "unknown or denied effective state keeps every mutation disabled" <|
            \_ ->
                let
                    base : RuntimeDomain.ServiceIntegrationView
                    base =
                        { requestId = "integration_request_0003"
                        , feature = "outhook"
                        , operation = Just "outhook-list"
                        , phase = "accepted"
                        , registry = "enabled"
                        , effectiveFeature = "unknown"
                        , accountProof = "unknown"
                        , authorization = "allowed"
                        , reason = Nothing
                        , rows = [ { kind = "entry", label = "Outbound hook", value = Just "Stored webhook", ref = Just "opaque_url_reference_00000002" } ]
                        , inputRef = Nothing
                        }

                    render v =
                        View.Integrations.serviceIntegrationPanel (Just v) App.emptyServiceIntegrationForm |> Query.fromHtml

                    removeDisabled v =
                        Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Remove hook" ] ] (render v) |> Query.has [ Selector.disabled True ]
                in
                Expect.all
                    [ \_ -> removeDisabled base
                    , \_ -> removeDisabled { base | effectiveFeature = "disabled" }
                    , \_ -> removeDisabled { base | effectiveFeature = "enabled", authorization = "denied" }
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Grant speak" ] ] (render { base | feature = "botgrant" }) |> Query.has [ Selector.disabled True ]
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Inspect private URL" ] ] (render base) |> Query.hasNot [ Selector.disabled True ]
                    ]
                    ()
        , test "explicit UNFURL OFF remains available to check a disabled setting" <|
            \_ ->
                let
                    disabledPreviewView : RuntimeDomain.ServiceIntegrationView
                    disabledPreviewView =
                        { requestId = "integration_request_0002"
                        , feature = "unfurl"
                        , operation = Nothing
                        , phase = "idle"
                        , registry = "enabled"
                        , effectiveFeature = "disabled"
                        , accountProof = "unknown"
                        , authorization = "allowed"
                        , reason = Nothing
                        , rows = []
                        , inputRef = Nothing
                        }

                    query =
                        View.Integrations.serviceIntegrationPanel (Just disabledPreviewView) App.emptyServiceIntegrationForm
                            |> Query.fromHtml
                in
                Expect.all
                    [ \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Check and refuse previews" ] ] query |> Query.hasNot [ Selector.disabled True ]
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Check and refuse previews" ] ] query |> Event.simulate Event.click |> Event.expect (App.RuntimeDomainActionRequested RuntimeDomain.ServiceUnfurlOff)
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Opt in to previews" ] ] query |> Query.has [ Selector.disabled True ]
                    , \_ -> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Fetch this preview" ] ] query |> Query.has [ Selector.disabled True ]
                    ]
                    ()
        , test "memo queue acceptance does not claim server delivery" <|
            \_ ->
                let
                    queuedMemoView : RuntimeDomain.ServiceIntegrationView
                    queuedMemoView =
                        { requestId = "integration_request_0003"
                        , feature = "memo"
                        , operation = Just "send"
                        , phase = "accepted"
                        , registry = "enabled"
                        , effectiveFeature = "enabled"
                        , accountProof = "satisfied"
                        , authorization = "allowed"
                        , reason = Nothing
                        , rows = []
                        , inputRef = Nothing
                        }

                    query =
                        View.Integrations.serviceIntegrationPanel (Just queuedMemoView) App.emptyServiceIntegrationForm
                            |> Query.fromHtml
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.text "Queued locally. Delivery has not been confirmed." ] query
                    , \_ -> Query.hasNot [ Selector.text "Server confirmed" ] query
                    ]
                    ()
        ]
