import { FetchRequest, JsonRpcProvider, Network, Wallet } from 'ethers';
import { PROVIDER_FETCH_TIMEOUT } from '../src/common/common-types';
import { getBundlerChainConfig } from '../src/configs/bundler-common';

const passkeyAddress = '0x34A40415d9daF5D3CCDf0EffCa36416e5558C208';
const webAuthnAddress = '0x012261Dcdd79D40F5C0703c4B179d30BDCf8f1F3';

const deployWebAuthn = async (chainId: number, signer: Wallet) => {
    const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
    const network = new Network('', chainId);
    const fetchRequest = new FetchRequest(rpcUrl);
    fetchRequest.timeout = PROVIDER_FETCH_TIMEOUT;
    const provider = new JsonRpcProvider(fetchRequest, network, { batchMaxCount: 1, staticNetwork: network });
    signer = signer.connect(provider);

    const feeData = await provider.getFeeData();

    const code = await provider.getCode(webAuthnAddress);
    if (code.length > 2) {
        console.log('WebAuthn already deployed');
        return;
    }
    console.log(JSON.stringify(feeData));
    let gasPrice: any = feeData.gasPrice;
    let maxFeePerGas: any = null;
    let maxPriorityFeePerGas: any = null;

    const r = await signer.sendTransaction({
        type: 0,
        to: '0x4e59b44847b379578588920ca78fbf26c0b4956c',
        data: webAuthnData,
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
    });

    console.log(r);
};

export const deployPasskeyModule = async (chainId: number, signer: Wallet) => {
    await deployWebAuthn(chainId, signer);

    const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
    const network = new Network('', chainId);
    const fetchRequest = new FetchRequest(rpcUrl);
    fetchRequest.timeout = PROVIDER_FETCH_TIMEOUT;
    const provider = new JsonRpcProvider(fetchRequest, network, { batchMaxCount: 1, staticNetwork: network });
    signer = signer.connect(provider);

    const feeData = await provider.getFeeData();

    const code = await provider.getCode(passkeyAddress);
    if (code.length > 2) {
        console.log('Passkey module already deployed');
        return;
    }
    console.log(JSON.stringify(feeData));
    let gasPrice: any = feeData.gasPrice;
    let maxFeePerGas: any = null;
    let maxPriorityFeePerGas: any = null;

    const r = await signer.sendTransaction({
        type: 0,
        to: '0x4e59b44847b379578588920ca78fbf26c0b4956c',
        data: passkeyModuleData,
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
    });

    console.log(r);
};

const passkeyModuleData = `0x00000000000000000000000000000000000000000000000000000000000000006080806040523461001657610cbf908161001c8239f35b600080fdfe6040608081526004908136101561001557600080fd5b6000803560e01c8063032ff9f1146104175780631626ba7e14610417578063569a4457146103e857806373016096146102065780638d2bc52914610192578063a3f4df7e1461012b578063ffa1ad74146100ca5763fff35b7214610079575b600080fd5b346100c3576003199082823601126100c35783359167ffffffffffffffff83116100c6576101609083360301126100c357506020926100bc9160243591016106f8565b9051908152f35b80fd5b5080fd5b5090346100c657816003193601126100c6578051610127916100eb82610455565b600582527f302e322e30000000000000000000000000000000000000000000000000000000602083015251918291602083526020830190610671565b0390f35b5090346100c657816003193601126100c65780516101279161014c82610423565b602282527f506173734b657973204f776e657273686970205265676973747279204d6f64756020830152616c6560f01b8183015251918291602083526020830190610671565b509134610202576020366003190112610202573573ffffffffffffffffffffffffffffffffffffffff811680910361020257918192815280602052209061012782549160606101e86002600187015496016105a8565b918051958695865260208601528401526060830190610671565b8280fd5b50346100c35760603660031901126100c35760443567ffffffffffffffff80821161020257366023830112156102025781850135928184116100c35736602485850101116100c357338152602095818752858220541515806103d9575b6103c257600261028f87519561027887610423565b8335875289870197602435895260243692016104af565b95878601968752338452838952878420955186555194600195868201550194519081519384116103af57506102c4855461056e565b601f8111610369575b508691601f841160011461030a57918394918493946102ff575b50501b916000199060031b1c19161790555b51308152f35b0151925038806102e7565b919083601f198116878552898520945b8a888383106103525750505010610339575b505050811b0190556102f9565b015160001960f88460031b161c1916905538808061032c565b86860151885590960195948501948793500161031a565b858352878320601f850160051c8101918986106103a5575b601f0160051c019085905b82811061039a5750506102cd565b84815501859061038c565b9091508190610381565b634e487b7160e01b835260419052602482fd5b602490865190632c4dfb7d60e21b82523390820152fd5b50600186832001541515610263565b5090346100c657816003193601126100c6576020905173012261dcdd79d40f5c0703c4b179d30bdcf8f1f38152f35b50505050610074610504565b6060810190811067ffffffffffffffff82111761043f57604052565b634e487b7160e01b600052604160045260246000fd5b6040810190811067ffffffffffffffff82111761043f57604052565b90601f8019910116810190811067ffffffffffffffff82111761043f57604052565b67ffffffffffffffff811161043f57601f01601f191660200190565b9291926104bb82610493565b916104c96040519384610471565b829481845281830111610074578281602093846000960137010152565b9080601f8301121561007457816020610501933591016104af565b90565b50346100745760403660031901126100745760243567ffffffffffffffff81116100745761054361053b60209236906004016104e6565b600435610955565b6040517fffffffff000000000000000000000000000000000000000000000000000000009091168152f35b90600182811c9216801561059e575b602083101461058857565b634e487b7160e01b600052602260045260246000fd5b91607f169161057d565b90604051918260008254926105bc8461056e565b90818452600194858116908160001461062b57506001146105e8575b50506105e692500383610471565b565b9093915060005260209081600020936000915b8183106106135750506105e6935082010138806105d8565b855488840185015294850194879450918301916105fb565b9150506105e694506020925060ff191682840152151560051b82010138806105d8565b60005b8381106106615750506000910152565b8181015183820152602001610651565b9060209161068a8151809281855285808601910161064e565b601f01601f1916010190565b909291926106a381610493565b916106b16040519384610471565b8294828452828201116100745760206105e693019061064e565b9080601f8301121561007457815161050192602001610696565b519065ffffffffffff8216820361007457565b91909161014081013590601e1981360301821215610074570180359167ffffffffffffffff91828411610074576020918282019480360386136100745782016040958684830312610074573590858211610074578691858061075e9301918601016104e6565b92013573ffffffffffffffffffffffffffffffffffffffff8116036100745781518201858382031261007457838301519085821161007457869185806107a89301918601016106cb565b9201511561094657815182019060a083858401930312610074576107cd8484016106e5565b6107d88785016106e5565b9060608501519660808601518181116100745786019480603f8701121561007457878601519682881161043f5760059688881b8c519961081a8c83018c610471565b8a528c8b8b019183010191848311610074578d8c9101915b838310610936575050505060a081015192831161007457610855920188016106cb565b98885191878301937fffffffffffff0000000000000000000000000000000000000000000000000000809260d01b16855260d01b166026830152602c820152602c81526108a181610423565b519020946000955b84518710156109085786841b850186015190886000838310156108fb5750506000528552866000205b9560001981146108e557600101956108a9565b634e487b7160e01b600052601160045260246000fd5b91909282528752206108d2565b93509550959350508391500361092f5761092191610a2a565b61092a57600190565b600090565b5050600190565b82518152918101918c9101610832565b94915091506109219250610a2a565b9061095f91610a2a565b610987577fffffffff0000000000000000000000000000000000000000000000000000000090565b630b135d3f60e11b90565b90816020910312610074575180151581036100745790565b90916109c46080939695949660a0845260a0840190610671565b60006020840152828103604084015260a0806109fe6109ec855160c0865260c0860190610671565b60208601518582036020870152610671565b936040810151604085015260608101516060850152868101518785015201519101529460608201520152565b908051810191602090818401828486031261007457828401519367ffffffffffffffff948581116100745760c09101809603126100745760409485519460c086018681108282111761043f57875284820151818111610074578386610a91928501016106cb565b86528682015190811161007457810182603f820112156100745760c092818887610abe9401519101610696565b848601526060810151868601526080810151606086015260a08101516080860152015160a084015260009033825281835284822093855191610aff83610423565b85548352610b1a6002600188015497878601988952016105a8565b8784015282511580610c80575b610c69577f19457468657265756d205369676e6564204d6573736167653a0a333200000000845280601c52603c84209087519186830152858252610b6a82610455565b835191875192610b8e8a519485928763fca6b59560e01b95868652600486016109aa565b0392878173012261dcdd79d40f5c0703c4b179d30bdcf8f1f39581875afa908115610c5f578791610c42575b50610c3457610bee87958a519387850152868452610bd784610455565b5198518a51998a96879586958652600486016109aa565b03915afa938415610c2a575092610c0457505090565b6105019250803d10610c23575b610c1b8183610471565b810190610992565b503d610c11565b51903d90823e3d90fd5b505050505050505050600190565b610c599150883d8a11610c2357610c1b8183610471565b38610bba565b8a513d89823e3d90fd5b865163ce777ecf60e01b8152336004820152602490fd5b50855115610b2756fea2646970667358221220f34b7dd02882f3e45831c028a880d38ac7db88e7bce7a4d39c529b237c9d05e364736f6c63430008110033`;

const webAuthnData = `0x0000000000000000000000000000000000000000000000000000000000000000608060405234801561001057600080fd5b5061211a806100206000396000f3fe608060405234801561001057600080fd5b506004361061002b5760003560e01c8063fca6b59514610030575b600080fd5b61004361003e366004611c92565b610057565b604051901515815260200160405180910390f35b60006100a687878080601f01602080910402602001604051908101604052809392919081815260200183838082843760009201919091525089925061009f9150889050611e4f565b86866100b1565b979650505050505050565b60006100de60027fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551611f16565b8460a0015111156100f1575060006104b2565b606084015160009061011490610108816015611f51565b602088015191906104bb565b90507fff1a2a9176d650e4a99dedb58f1793003935130579fe17b5a3f698ac5b00e63481805190602001201461014e5760009150506104b2565b600061015988610540565b6040516020016101699190611f88565b604051602081830303815290604052905060006101a18760400151835189604001516101959190611f51565b60208a015191906104bb565b905081805190602001208180519060200120146101c457600093505050506104b2565b865180517f010000000000000000000000000000000000000000000000000000000000000091829160209081106101fd576101fd611ff4565b0160200151167fff00000000000000000000000000000000000000000000000000000000000000161461023657600093505050506104b2565b8780156102a25750865180517f0400000000000000000000000000000000000000000000000000000000000000918291602090811061027757610277611ff4565b0160200151167fff000000000000000000000000000000000000000000000000000000000000001614155b156102b357600093505050506104b2565b6000600288602001516040516102c99190612023565b602060405180830381855afa1580156102e6573d6000803e3d6000fd5b5050506040513d601f19601f82011682018060405250810190610309919061203f565b905060006002896000015183604051602001610326929190612058565b604080517fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe08184030181529082905261035e91612023565b602060405180830381855afa15801561037b573d6000803e3d6000fd5b5050506040513d601f19601f8201168201806040525081019061039e919061203f565b6080808b015160a0808d015160408051602081018790529081019390935260608301529181018b905290810189905290915060009060c001604051602081830303815290604052905060008061010073ffffffffffffffffffffffffffffffffffffffff16836040516104119190612023565b600060405180830381855afa9150503d806000811461044c576040519150601f19603f3d011682016040523d82523d6000602084013e610451565b606091505b508051919350915015158280156104655750805b15610491578180602001905181019061047e919061203f565b60011499505050505050505050506104b2565b6104a6858e608001518f60a001518f8f61056c565b99505050505050505050505b95945050505050565b606083518281116104ca578092505b8381116104d5578093505b50818310156105395750604051828203808252938301937fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f820181165b86810151848201528101806105145750600083830160200152603f9091011681016040525b9392505050565b6060610566826040518060600160405280604081526020016120a56040913960006106bb565b92915050565b600084158061059b57507fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc6325518510155b806105a4575083155b806105cf57507fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc6325518410155b156105dc575060006104b2565b6105e6838361083b565b6105f2575060006104b2565b60006105fd856109b4565b905060007fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551828909905060007fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc6325518389099050600061065d87878585610a38565b90507fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc6325516106aa8a7fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc63255161207a565b8208159a9950505050505050505050565b606083516000036106db5750604080516020810190915260008152610539565b60008261070c576003855160046106f2919061208d565b6106fd906002611f51565b6107079190611f16565b610731565b60038551600261071c9190611f51565b6107269190611f16565b61073190600461208d565b905060008167ffffffffffffffff81111561074e5761074e611d4c565b6040519080825280601f01601f191660200182016040528015610778576020820181803683370190505b50905060018501602082018788518901602081018051600082525b828410156107ee576003840193508351603f8160121c168701518653600186019550603f81600c1c168701518653600186019550603f8160061c168701518653600186019550603f8116870151865350600185019450610793565b90525050851561082f5760038851066001811461081257600281146108255761082d565b603d6001830353603d600283035361082d565b603d60018303535b505b50909695505050505050565b60007fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8310158061088c57507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8210155b8061089e57508215801561089e575081155b156108ab57506000610566565b60007fffffffff00000001000000000000000000000000ffffffffffffffffffffffff838409905060007fffffffff00000001000000000000000000000000ffffffffffffffffffffffff807fffffffff00000001000000000000000000000000fffffffffffffffffffffffc87097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff877fffffffff00000001000000000000000000000000ffffffffffffffffffffffff898a09090890507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff7f5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b820891909114949350505050565b600060405160208152602080820152602060408201528260608201527fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc63254f60808201527fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc63255160a082015260208160c0836005600019fa610a3157600080fd5b5192915050565b600080808060ff818088158015610a4d575087155b15610a61576000965050505050505061154e565b610aad7f6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2967f4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f58d8d611556565b909250905081158015610abe575080155b15610b2f577fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551887fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551038a0898506000975088158015610b1b575087155b15610b2f576000965050505050505061154e565b600189841c16600189851c1660011b015b80610b625760018403935060018a851c1660018a861c1660011b019050610b40565b50600189841c16600189851c1660011b01955060018603610bc4577f6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c29696507f4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f593505b60028603610bd3578a96508993505b60038603610be2578196508093505b60018303925060019550600194505b827fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff11156114a4577fffffffff00000001000000000000000000000000ffffffffffffffffffffffff846002097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8182097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff818a097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff82840992507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff807fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8b8d087fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8c7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff038e08096003097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff89850998507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8a840999507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80837fffffffff00000001000000000000000000000000fffffffffffffffffffffffd097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff838409089a507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80837fffffffff00000001000000000000000000000000ffffffffffffffffffffffff038d08820992507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff837fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8a870908975060018d881c1660018d891c1660011b01905080610ecd57877fffffffff00000001000000000000000000000000ffffffffffffffffffffffff03975050505050611499565b60018103610f1c577f6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c29693507f4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f592505b60028103610f2b578e93508d92505b60038103610f3a578593508492505b89610f5357509198506001975087965094506114999050565b7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff887fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8b8609087fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8c7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff037fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8d8809089350806112925783611292577fffffffff00000001000000000000000000000000ffffffffffffffffffffffff897fffffffff00000001000000000000000000000000fffffffffffffffffffffffd0994507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff85860993507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff848d0992507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff84860994507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff808c7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff038e087fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8d8f080990507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8160030991507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8a860999507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8b85099a507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80847fffffffff00000001000000000000000000000000fffffffffffffffffffffffd097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff848509089b507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff808d7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff038508830993507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff808a8709850898505050505050611499565b7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff84850991507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8483097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff838d099b507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff818c099a507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff838e097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80827fffffffff00000001000000000000000000000000fffffffffffffffffffffffd097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff847fffffffff00000001000000000000000000000000ffffffffffffffffffffffff037fffffffff00000001000000000000000000000000ffffffffffffffffffffffff878809080893507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80838d097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff857fffffffff00000001000000000000000000000000ffffffffffffffffffffffff887fffffffff00000001000000000000000000000000ffffffffffffffffffffffff03860809089a50505050809a50505050505b600183039250610bf1565b60405186606082015260208152602080820152602060408201527fffffffff00000001000000000000000000000000fffffffffffffffffffffffd60808201527fffffffff00000001000000000000000000000000ffffffffffffffffffffffff60a082015260208160c0836005600019fa61151f57600080fd5b7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff815189099750505050505050505b949350505050565b60008080808661156d5785859350935050506115db565b8461157f5787879350935050506115db565b858814801561158d57508487145b156115ae5761159f88886001806115e4565b929a50909850925090506115c8565b6115bd88886001808a8a61186e565b929a50909850925090505b6115d488888484611b33565b9350935050505b94509492505050565b6000806000807fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8760020993507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff84850991507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff82890990507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff82850992507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff86830991507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff807fffffffff00000001000000000000000000000000ffffffffffffffffffffffff888b087fffffffff00000001000000000000000000000000ffffffffffffffffffffffff897fffffffff00000001000000000000000000000000ffffffffffffffffffffffff038c080960030995507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80827fffffffff00000001000000000000000000000000fffffffffffffffffffffffd097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8889090893507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80857fffffffff00000001000000000000000000000000ffffffffffffffffffffffff038308870997507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff85840990507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff808885097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff0389089250945094509450949050565b6000806000808860000361188d57508492508391506001905080611b26565b7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff9889039889818988090894507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8a7fffffffff00000001000000000000000000000000ffffffffffffffffffffffff037fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8a89090895507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff86870993507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff86850992507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff84890991507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff83880990507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff848b0997507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80897fffffffff00000001000000000000000000000000fffffffffffffffffffffffd097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff857fffffffff00000001000000000000000000000000ffffffffffffffffffffffff037fffffffff00000001000000000000000000000000ffffffffffffffffffffffff898a09080893507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff80848b097fffffffff00000001000000000000000000000000ffffffffffffffffffffffff877fffffffff00000001000000000000000000000000ffffffffffffffffffffffff887fffffffff00000001000000000000000000000000ffffffffffffffffffffffff038d08090892505b9650965096509692505050565b6000806000611b4184611be8565b90507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff818709915060007fffffffff00000001000000000000000000000000ffffffffffffffffffffffff82870990507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff81820991507fffffffff00000001000000000000000000000000ffffffffffffffffffffffff8289099350505094509492505050565b600060405160208152602080820152602060408201528260608201527fffffffff00000001000000000000000000000000fffffffffffffffffffffffd60808201527fffffffff00000001000000000000000000000000ffffffffffffffffffffffff60a082015260208160c0836005600019fa610a3157600080fd5b80358015158114611c7557600080fd5b919050565b600060c08284031215611c8c57600080fd5b50919050565b60008060008060008060a08789031215611cab57600080fd5b863567ffffffffffffffff80821115611cc357600080fd5b818901915089601f830112611cd757600080fd5b813581811115611ce657600080fd5b8a6020828501011115611cf857600080fd5b60208301985080975050611d0e60208a01611c65565b95506040890135915080821115611d2457600080fd5b50611d3189828a01611c7a565b93505060608701359150608087013590509295509295509295565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b60405160c0810167ffffffffffffffff81118282101715611d9e57611d9e611d4c565b60405290565b600082601f830112611db557600080fd5b813567ffffffffffffffff80821115611dd057611dd0611d4c565b604051601f83017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0908116603f01168101908282118183101715611e1657611e16611d4c565b81604052838152866020858801011115611e2f57600080fd5b836020870160208301376000602085830101528094505050505092915050565b600060c08236031215611e6157600080fd5b611e69611d7b565b823567ffffffffffffffff80821115611e8157600080fd5b611e8d36838701611da4565b83526020850135915080821115611ea357600080fd5b50611eb036828601611da4565b60208301525060408301356040820152606083013560608201526080830135608082015260a083013560a082015280915050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b600082611f4c577f4e487b7100000000000000000000000000000000000000000000000000000000600052601260045260246000fd5b500490565b8082018082111561056657610566611ee7565b60005b83811015611f7f578181015183820152602001611f67565b50506000910152565b7f226368616c6c656e6765223a2200000000000000000000000000000000000000815260008251611fc081600d850160208701611f64565b7f2200000000000000000000000000000000000000000000000000000000000000600d939091019283015250600e01919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052603260045260246000fd5b60008251612035818460208701611f64565b9190910192915050565b60006020828403121561205157600080fd5b5051919050565b6000835161206a818460208801611f64565b9190910191825250602001919050565b8181038181111561056657610566611ee7565b808202811582820484141761056657610566611ee756fe4142434445464748494a4b4c4d4e4f505152535455565758595a6162636465666768696a6b6c6d6e6f707172737475767778797a303132333435363738392d5fa26469706673582212208b5e62388575ed5474135c8736d7dadf86c4a162716cb4e20282594153da23d864736f6c63430008180033`;
