module ProvenanceTest exposing (suite)

{-| Oracle-mirrored vectors for `Provenance` (mirroring
`src/lib/intelligence/provenance.test.ts`: scope labels plus the
subject-specific accessible description).
-}

import Expect
import Provenance exposing (Scope(..))
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Provenance"
        [ test "names local, server, and external execution scopes" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "This device" (Provenance.labelFor Device)
                    , \_ -> Expect.equal True (String.contains "locally" (Provenance.descriptionFor Device))
                    , \_ -> Expect.equal "This server" (Provenance.labelFor Server)
                    , \_ -> Expect.equal True (String.contains "server-side history" (Provenance.descriptionFor Server))
                    , \_ -> Expect.equal "External" (Provenance.labelFor External)
                    , \_ -> Expect.equal True (String.contains "external endpoint" (Provenance.descriptionFor External))
                    ]
                    ()
        , test "builds accessible subject-specific provenance descriptions" <|
            \_ ->
                Expect.equal
                    "Search results provenance: This device. Computed locally in this browser from loaded or saved Onyx data."
                    (Provenance.ariaLabel Device "Search results")
        , test "scopes round-trip through their data-scope tokens" <|
            \_ ->
                Expect.equal
                    [ "device", "server", "external" ]
                    (List.map Provenance.scopeToString [ Device, Server, External ])
        ]
