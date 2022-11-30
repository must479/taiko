import { expect } from "chai"
import { AddressManager, TkoToken, TokenVault } from "../../typechain"
import { ethers } from "hardhat"
import { BigNumber, BigNumberish, BytesLike } from "ethers"
import { ADDRESS_RESOLVER_DENIED } from "../constants/errors"
import { Message } from "../utils/message"
import { Block, BlockHeader, EthGetProofResponse } from "../utils/rpc"
import RLP from "rlp"
import { deployBridgeFixture } from "../utils/fixtures/bridge"

type CanonicalERC20 = {
    chainId: BigNumberish
    addr: string
    decimals: BigNumberish
    symbol: string
    name: string
}

const weth: CanonicalERC20 = {
    chainId: 5,
    addr: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
    decimals: 18,
    symbol: "WETH",
    name: "Wrapped Ether",
}

describe("TokenVault", function () {
    async function deployTokenVaultFixture() {
        const [owner, nonOwner] = await ethers.getSigners()

        const libTrieProof = await (
            await ethers.getContractFactory("LibTrieProof")
        ).deploy()

        // Deploying addressManager Contract
        const tokenVaultAddressManager: AddressManager = await (
            await ethers.getContractFactory("AddressManager")
        ).deploy()
        await tokenVaultAddressManager.init()

        const TokenVaultFactory = await ethers.getContractFactory(
            "TokenVault",
            {
                libraries: {
                    LibTrieProof: libTrieProof.address,
                },
            }
        )

        const tokenVault: TokenVault = await TokenVaultFactory.connect(
            owner
        ).deploy()

        await tokenVault.init(tokenVaultAddressManager.address)

        const network = await ethers.provider.getNetwork()

        const TestMessageSenderFactory = await ethers.getContractFactory(
            "TestMessageSender"
        )

        const testMessageSender = await TestMessageSenderFactory.deploy()

        await tokenVaultAddressManager.setAddress(
            `${network.chainId}.bridge`,
            testMessageSender.address
        )
        return {
            owner,
            nonOwner,
            tokenVault,
            tokenVaultAddressManager,
        }
    }

    describe("receiveERC20()", async () => {
        it("throws when named 'bridge' is not the caller", async () => {
            const { owner, nonOwner, tokenVault } =
                await deployTokenVaultFixture()
            const amount = BigNumber.from(1)

            await expect(
                tokenVault.receiveERC20(
                    weth,
                    owner.address,
                    nonOwner.address,
                    amount
                )
            ).to.be.revertedWith(ADDRESS_RESOLVER_DENIED)
        })
    })

    describe("sendEther()", async () => {
        it("throws when msg.value is 0", async () => {
            const { owner, tokenVault } = await deployTokenVaultFixture()

            const processingFee = 10

            await expect(
                tokenVault.sendEther(
                    167001,
                    owner.address,
                    10000,
                    processingFee,
                    owner.address,
                    ""
                )
            ).to.be.revertedWith("V:msgValue")
        })

        it("throws when msg.value - processing fee is 0", async () => {
            const { owner, tokenVault } = await deployTokenVaultFixture()

            const processingFee = 10

            await expect(
                tokenVault.sendEther(
                    167001,
                    owner.address,
                    10000,
                    processingFee,
                    owner.address,
                    "",
                    {
                        value: processingFee,
                    }
                )
            ).to.be.revertedWith("V:msgValue")
        })

        it("throws when msg.value is < processingFee", async () => {
            const { owner, tokenVault } = await deployTokenVaultFixture()

            const processingFee = 10

            await expect(
                tokenVault.sendEther(
                    167001,
                    owner.address,
                    10000,
                    processingFee,
                    owner.address,
                    "",
                    {
                        value: processingFee - 1,
                    }
                )
            ).to.be.revertedWith("V:msgValue")
        })

        it("throws when to is 0", async () => {
            const { owner, tokenVault } = await deployTokenVaultFixture()

            const processingFee = 10

            await expect(
                tokenVault.sendEther(
                    167001,
                    ethers.constants.AddressZero,
                    10000,
                    processingFee,
                    owner.address,
                    "",
                    {
                        value: processingFee - 1,
                    }
                )
            ).to.be.revertedWith("V:to")
        })

        it("succeeds with processingFee", async () => {
            const { owner, tokenVault } = await deployTokenVaultFixture()

            const processingFee = 10
            const depositValue = 1000
            const destChainId = 167001

            const testSignal =
                "0x3fd54831f488a22b28398de0c567a3b064b937f54f81739ae9bd545967f3abab"

            await expect(
                tokenVault.sendEther(
                    destChainId,
                    owner.address,
                    10000,
                    processingFee,
                    owner.address,
                    "",
                    {
                        value: depositValue,
                    }
                )
            )
                .to.emit(tokenVault, "EtherSent")
                .withArgs(
                    owner.address,
                    destChainId,
                    depositValue - processingFee,
                    testSignal
                )
        })

        it("succeeds with 0 processingFee", async () => {
            const { owner, tokenVault } = await deployTokenVaultFixture()

            const processingFee = 0
            const depositValue = 1000
            const destChainId = 167001

            const testSignal =
                "0x3fd54831f488a22b28398de0c567a3b064b937f54f81739ae9bd545967f3abab"

            await expect(
                tokenVault.sendEther(
                    destChainId,
                    owner.address,
                    10000,
                    processingFee,
                    owner.address,
                    "",
                    {
                        value: depositValue,
                    }
                )
            )
                .to.emit(tokenVault, "EtherSent")
                .withArgs(
                    owner.address,
                    destChainId,
                    depositValue - processingFee,
                    testSignal
                )
        })
    })
})

describe("integration:Bridge", () => {
    async function deployTokenVaultFixture() {
        const [owner, nonOwner] = await ethers.getSigners()

        const { chainId: srcChainId } = await ethers.provider.getNetwork()

        const libTrieProof = await (
            await ethers.getContractFactory("LibTrieProof")
        ).deploy()

        // Deploying addressManager Contract
        const tokenVaultAddressManager: AddressManager = await (
            await ethers.getContractFactory("AddressManager")
        ).deploy()
        await tokenVaultAddressManager.init()

        const TokenVaultFactory = await ethers.getContractFactory(
            "TokenVault",
            {
                libraries: {
                    LibTrieProof: libTrieProof.address,
                },
            }
        )

        const tokenVault: TokenVault = await TokenVaultFactory.connect(
            owner
        ).deploy()

        await tokenVault.init(tokenVaultAddressManager.address)

        const TestMessageSenderFactory = await ethers.getContractFactory(
            "TestMessageSender"
        )

        const testMessageSender = await TestMessageSenderFactory.deploy()

        await tokenVaultAddressManager.setAddress(
            `${srcChainId}.bridge`,
            testMessageSender.address
        )

        const l2Provider = new ethers.providers.JsonRpcProvider(
            "http://localhost:28545"
        )

        const l2Signer = await l2Provider.getSigner(
            "0x4D9E82AC620246f6782EAaBaC3E3c86895f3f0F8"
        )

        const l2Network = await l2Provider.getNetwork()
        const enabledDestChainId = l2Network.chainId

        await tokenVaultAddressManager.setAddress(
            `${enabledDestChainId}.bridge`,
            testMessageSender.address
        )

        const TkoTokenFactory = await ethers.getContractFactory("TkoToken")

        const token: TkoToken = await TkoTokenFactory.connect(owner).deploy()

        await token.init(tokenVaultAddressManager.address)

        const { chainId } = await ethers.provider.getNetwork()

        await tokenVaultAddressManager.setAddress(
            `${chainId}.proto_broker`,
            owner.address
        )
        const amountMinted = ethers.utils.parseEther("100")
        await token.connect(owner).mint(owner.address, amountMinted)

        const ownerBalance = await token.balanceOf(owner.address)
        expect(ownerBalance).to.be.eq(amountMinted)

        return {
            owner,
            l2Signer,
            enabledDestChainId,
            srcChainId,
            l2Network,
            nonOwner,
            tokenVault,
            tokenVaultAddressManager,
            token,
        }
    }

    describe("releaseTokens", () => {
        it("throws when msg.sender is not the message owner", async () => {
            const { owner, nonOwner, tokenVault } =
                await deployTokenVaultFixture()

            const srcChainId = 167001
            const enabledDestChainId = 31336
            const m: Message = {
                id: 1,
                sender: owner.address,
                srcChainId: srcChainId,
                destChainId: enabledDestChainId,
                owner: owner.address,
                to: owner.address,
                refundAddress: owner.address,
                depositValue: 1000,
                callValue: 1000,
                processingFee: 1000,
                gasLimit: 10000,
                data: ethers.constants.HashZero,
                memo: "",
            }

            await expect(
                tokenVault
                    .connect(nonOwner)
                    .releaseTokens(
                        ethers.utils.randomBytes(32),
                        m,
                        ethers.utils.randomBytes(32),
                        "0x00"
                    )
            ).to.be.revertedWith("V:owner")
        })

        it.only("succeeds when proof is valid", async () => {
            const { owner, tokenVault, token } = await deployTokenVaultFixture()
            const { l1Bridge, l2Bridge, enabledDestChainId, headerSync } =
                await deployBridgeFixture()

            let signal: BytesLike = ""
            let message: any = {}

            l1Bridge.on("MessageSent", (_signal, _message) => {
                console.log("got message sent event")
                signal = _signal
                message = _message
            })

            const amount = BigNumber.from(100)

            await token.approve(tokenVault.address, amount)

            expect(
                await token.allowance(owner.address, tokenVault.address)
            ).to.be.eq(amount)

            const tx = await tokenVault
                .connect(owner)
                .sendERC20(
                    enabledDestChainId,
                    owner.address,
                    token.address,
                    amount,
                    100000,
                    0,
                    owner.address,
                    ""
                )

            await tx.wait()
            await new Promise((resolve) =>
                setTimeout(() => resolve(null), 5000)
            )

            console.log(signal)
            console.log(message)
            expect(signal).not.to.be.eq(ethers.constants.HashZero)

            const messageStatus = await l1Bridge.getMessageStatus(signal)

            expect(messageStatus).to.be.eq(0)

            const signalSentKey = ethers.utils.keccak256(
                ethers.utils.solidityPack(
                    ["address", "bytes32"],
                    [l1Bridge.address, signal]
                )
            )

            const block: Block = await ethers.provider.send(
                "eth_getBlockByNumber",
                ["latest", false]
            )

            const storageValue = await ethers.provider.getStorageAt(
                l1Bridge.address,
                signalSentKey,
                block.number
            )

            expect(storageValue).to.be.eq(
                "0x0000000000000000000000000000000000000000000000000000000000000001"
            )

            await headerSync.setSyncedHeader(ethers.constants.HashZero)

            const logsBloom = block.logsBloom.toString().substring(2)

            const blockHeader: BlockHeader = {
                parentHash: block.parentHash,
                ommersHash: block.sha3Uncles,
                beneficiary: block.miner,
                stateRoot: block.stateRoot,
                transactionsRoot: block.transactionsRoot,
                receiptsRoot: block.receiptsRoot,
                logsBloom: logsBloom
                    .match(/.{1,64}/g)!
                    .map((s: string) => "0x" + s),
                difficulty: block.difficulty,
                height: block.number,
                gasLimit: block.gasLimit,
                gasUsed: block.gasUsed,
                timestamp: block.timestamp,
                extraData: block.extraData,
                mixHash: block.mixHash,
                nonce: block.nonce,
                baseFeePerGas: block.baseFeePerGas
                    ? parseInt(block.baseFeePerGas)
                    : 0,
            }

            // make sure it equals 1 so our proof will pass
            expect(storageValue).to.be.eq(
                "0x0000000000000000000000000000000000000000000000000000000000000001"
            )
            // rpc call to get the merkle proof what value is at key on the bridge contract
            const signalSentProof: EthGetProofResponse =
                await ethers.provider.send("eth_getProof", [
                    l1Bridge.address,
                    [signalSentKey],
                    block.hash,
                ])

            // RLP encode the proof together for LibTrieProof to decode
            const encodedProof = ethers.utils.defaultAbiCoder.encode(
                ["bytes", "bytes"],
                [
                    RLP.encode(signalSentProof.accountProof),
                    RLP.encode(signalSentProof.storageProof[0].proof),
                ]
            )

            // encode the SignalProof struct from LibBridgeSignal
            const signalProof = ethers.utils.defaultAbiCoder.encode(
                [
                    "tuple(tuple(bytes32 parentHash, bytes32 ommersHash, address beneficiary, bytes32 stateRoot, bytes32 transactionsRoot, bytes32 receiptsRoot, bytes32[8] logsBloom, uint256 difficulty, uint128 height, uint64 gasLimit, uint64 gasUsed, uint64 timestamp, bytes extraData, bytes32 mixHash, uint64 nonce, uint256 baseFeePerGas) header, bytes proof)",
                ],
                [{ header: blockHeader, proof: encodedProof }]
            )

            // now make transaction fail, will enter status RETRIABLE

            await l2Bridge.connect(owner).processMessage(message, signalProof)

            // then retry it, make fail again, now it is status FAILED and tokens can be released
            // on the source chain with a proof from the dest layer bridge.

            await l2Bridge.connect(owner).retryMessage(message, true)

            const signalFailedKey = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["bytes32", "uint", "uint"],
                    [signal, 1, 0]
                )
            )

            const signalFailBlock: Block = await ethers.provider.send(
                "eth_getBlockByNumber",
                ["latest", false]
            )

            // get storageValue for the key
            const signalFailStorageValue = await ethers.provider.getStorageAt(
                l2Bridge.address,
                signalFailedKey,
                block.number
            )

            // make sure it equals 3 so our proof will pass
            expect(signalFailStorageValue).to.be.eq(
                "0x0000000000000000000000000000000000000000000000000000000000000003" // enum message fail status
            )

            // rpc call to get the merkle proof what value is at key on the bridge contract
            const proof: EthGetProofResponse = await ethers.provider.send(
                "eth_getProof",
                [l2Bridge.address, [signalFailedKey], block.hash]
            )

            // RLP encode the proof together for LibTrieProof to decode
            const bytesProof = ethers.utils.defaultAbiCoder.encode(
                ["bytes", "bytes"],
                [
                    RLP.encode(proof.accountProof),
                    RLP.encode(proof.storageProof[0].proof),
                ]
            )

            await tokenVault
                .connect(owner)
                .releaseTokens(
                    signal,
                    message,
                    signalFailBlock.stateRoot,
                    bytesProof
                )
        })
    })
})
