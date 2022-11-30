import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber, Signer } from "ethers"
import { ethers } from "hardhat"
import {
    AddressManager,
    Bridge,
    EtherVault,
    TestHeaderSync,
} from "../../../typechain"

export async function deployBridge(
    signer: Signer,
    addressManager: AddressManager,
    destChain: number,
    srcChain: number
): Promise<{ bridge: Bridge; etherVault: EtherVault }> {
    const libTrieProof = await (await ethers.getContractFactory("LibTrieProof"))
        .connect(signer)
        .deploy()

    const libBridgeProcess = await (
        await ethers.getContractFactory("LibBridgeProcess", {
            libraries: {
                LibTrieProof: libTrieProof.address,
            },
        })
    )
        .connect(signer)
        .deploy()

    const libBridgeRetry = await (
        await ethers.getContractFactory("LibBridgeRetry")
    )
        .connect(signer)
        .deploy()

    const BridgeFactory = await ethers.getContractFactory("Bridge", {
        libraries: {
            LibBridgeProcess: libBridgeProcess.address,
            LibBridgeRetry: libBridgeRetry.address,
            LibTrieProof: libTrieProof.address,
        },
    })

    const bridge: Bridge = await BridgeFactory.connect(signer).deploy()

    await bridge.connect(signer).init(addressManager.address)

    await bridge.connect(signer).enableDestChain(destChain, true)

    const etherVault: EtherVault = await (
        await ethers.getContractFactory("EtherVault")
    )
        .connect(signer)
        .deploy()

    await etherVault.connect(signer).init(addressManager.address)

    await etherVault.connect(signer).authorize(bridge.address, true)

    await etherVault.connect(signer).authorize(await signer.getAddress(), true)

    await addressManager.setAddress(
        `${srcChain}.ether_vault`,
        etherVault.address
    )

    await signer.sendTransaction({
        to: etherVault.address,
        value: BigNumber.from(100000000),
        gasLimit: 1000000,
    })

    return { bridge, etherVault }
}

export async function deployBridgeFixture(): Promise<{
    owner: SignerWithAddress
    l2Signer: Signer
    nonOwner: SignerWithAddress
    l2NonOwner: Signer
    l1Bridge: Bridge
    l2Bridge: Bridge
    addressManager: AddressManager
    enabledDestChainId: number
    l1EtherVault: EtherVault
    l2EtherVault: EtherVault
    srcChainId: number
    headerSync: TestHeaderSync
}> {
    const [owner, nonOwner] = await ethers.getSigners()

    const { chainId } = await ethers.provider.getNetwork()

    const srcChainId = chainId

    // seondary node to deploy L2 on
    const l2Provider = new ethers.providers.JsonRpcProvider(
        "http://localhost:28545"
    )

    const l2Signer = await l2Provider.getSigner(
        "0x4D9E82AC620246f6782EAaBaC3E3c86895f3f0F8"
    )

    const l2NonOwner = await l2Provider.getSigner()

    const l2Network = await l2Provider.getNetwork()
    const enabledDestChainId = l2Network.chainId

    const addressManager: AddressManager = await (
        await ethers.getContractFactory("AddressManager")
    ).deploy()
    await addressManager.init()

    const l2AddressManager: AddressManager = await (
        await ethers.getContractFactory("AddressManager")
    )
        .connect(l2Signer)
        .deploy()
    await l2AddressManager.init()

    const { bridge: l1Bridge, etherVault: l1EtherVault } = await deployBridge(
        owner,
        addressManager,
        enabledDestChainId,
        srcChainId
    )

    const { bridge: l2Bridge, etherVault: l2EtherVault } = await deployBridge(
        l2Signer,
        l2AddressManager,
        srcChainId,
        enabledDestChainId
    )

    await addressManager.setAddress(
        `${enabledDestChainId}.bridge`,
        l2Bridge.address
    )

    await l2AddressManager
        .connect(l2Signer)
        .setAddress(`${srcChainId}.bridge`, l1Bridge.address)

    const headerSync = await (await ethers.getContractFactory("TestHeaderSync"))
        .connect(l2Signer)
        .deploy()

    await l2AddressManager
        .connect(l2Signer)
        .setAddress(`${enabledDestChainId}.taiko`, headerSync.address)

    return {
        owner,
        l2Signer,
        nonOwner,
        l2NonOwner,
        l1Bridge,
        l2Bridge,
        addressManager,
        enabledDestChainId,
        l1EtherVault,
        l2EtherVault,
        srcChainId,
        headerSync,
    }
}
